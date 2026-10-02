import type { D1Database } from "@cloudflare/workers-types";
import * as D1Client from "@effect/sql-d1/D1Client";
import {
  AuthClientKind,
  AuthorizationCode,
  EmailAddress,
  OtpChallengeId,
  UserId,
  type AuthorizationCode as AuthorizationCodeType,
  type EmailAddress as EmailAddressType,
  type OtpChallengeId as OtpChallengeIdType,
  type OtpCode,
  type UserId as UserIdType,
} from "@store/auth";
import { ephemeralRecord } from "@store/db/auth.schema";
import { and, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import * as D1Drizzle from "drizzle-orm/effect-d1";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { AuthCrypto } from "./crypto";
import { runD1Batch, type AuthDrizzle } from "./d1-batch";
import { storageFailureMessage } from "./errors";

const OTP_FAILURE_BUDGET = 5;

const OtpPayload = Schema.Struct({
  email: EmailAddress,
  verifier: Schema.String,
  failures: Schema.Int,
});

const TakenPayload = Schema.Struct({ payload: Schema.String });

const OAuthStatePayload = Schema.Struct({
  redirectUri: Schema.String,
  codeChallenge: Schema.String,
  client: AuthClientKind,
  googleCodeVerifier: Schema.optionalKey(Schema.String),
  googleNonce: Schema.optionalKey(Schema.String),
});
interface OAuthStateRecord extends Schema.Schema.Type<typeof OAuthStatePayload> {
  readonly expiresAt: number;
}

const AuthorizationGrantPayload = Schema.Struct({
  userId: UserId,
  codeChallenge: Schema.String,
  client: AuthClientKind,
});
interface AuthorizationGrantRecord extends Schema.Schema.Type<typeof AuthorizationGrantPayload> {
  readonly expiresAt: number;
}

export class EphemeralStoreError extends Schema.TaggedError<EphemeralStoreError>()(
  "Auth.EphemeralStoreError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export interface EphemeralStoreApi {
  readonly createOtp: (input: {
    readonly email: EmailAddressType;
    readonly code: OtpCode;
    readonly expiresAt: number;
  }) => Effect.Effect<OtpChallengeIdType, EphemeralStoreError>;
  readonly consumeOtp: (input: {
    readonly challengeId: OtpChallengeIdType;
    readonly code: OtpCode;
    readonly now: number;
  }) => Effect.Effect<EmailAddressType | null, EphemeralStoreError>;
  readonly createOAuthState: (input: {
    readonly redirectUri: string;
    readonly codeChallenge: string;
    readonly client: AuthClientKind;
    readonly googleCodeVerifier: string;
    readonly googleNonce: string;
    readonly expiresAt: number;
  }) => Effect.Effect<string, EphemeralStoreError>;
  readonly consumeOAuthState: (
    state: string,
    now: number,
  ) => Effect.Effect<OAuthStateRecord | null, EphemeralStoreError>;
  readonly createAuthorizationGrant: (input: {
    readonly userId: UserIdType;
    readonly codeChallenge: string;
    readonly client: AuthClientKind;
    readonly expiresAt: number;
  }) => Effect.Effect<AuthorizationCodeType, EphemeralStoreError>;
  readonly consumeAuthorizationGrant: (
    code: AuthorizationCodeType,
    now: number,
  ) => Effect.Effect<AuthorizationGrantRecord | null, EphemeralStoreError>;
}

export class EphemeralStore extends Context.Service<EphemeralStore, EphemeralStoreApi>()(
  "@store/auth-worker/EphemeralStore",
) {}

type EphemeralKind = typeof ephemeralRecord.$inferSelect.kind;

const EXPIRED_SWEEP_LIMIT = 32;

const error = (operation: string, cause: unknown) =>
  new EphemeralStoreError({ operation, message: storageFailureMessage(cause), cause });

const makeEphemeralStore = (
  database: AuthDrizzle,
  pepper: Redacted.Redacted<string>,
  crypto: AuthCrypto["Service"],
): EphemeralStoreApi => {
  const keyId = crypto.randomId.pipe(Effect.mapError((cause) => error("keyId", cause)));

  const recordKey = (kind: EphemeralKind, id: string) =>
    crypto.recordKey(pepper, kind, id).pipe(Effect.mapError((cause) => error("digest", cause)));

  const otpVerifier = (challengeId: OtpChallengeIdType, code: OtpCode) =>
    crypto
      .otpVerifier(pepper, challengeId, code)
      .pipe(Effect.mapError((cause) => error("verifier", cause)));

  const storedVerifier = sql`json_extract(${ephemeralRecord.payload}, '$.verifier')`;
  const storedFailures = sql`json_extract(${ephemeralRecord.payload}, '$.failures')`;

  const sweepExpired = (now: number) =>
    database
      .delete(ephemeralRecord)
      .where(
        inArray(
          ephemeralRecord.key,
          database
            .select({ key: ephemeralRecord.key })
            .from(ephemeralRecord)
            .where(lte(ephemeralRecord.expiresAt, now))
            .limit(EXPIRED_SWEEP_LIMIT),
        ),
      );

  const putRecord = <S extends Schema.Codec<unknown, unknown>>(
    operation: string,
    kind: EphemeralKind,
    id: string,
    schema: S,
    payload: S["Type"],
    expiresAt: number,
  ) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const key = yield* recordKey(kind, id);
      const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(schema))(payload).pipe(
        Effect.mapError((cause) => error(`${operation}.encode`, cause)),
      );
      yield* runD1Batch(database, [
        sweepExpired(now),
        database
          .insert(ephemeralRecord)
          .values({ key, kind, payload: encoded, expiresAt, createdAt: now }),
      ]).pipe(Effect.mapError((cause) => error(`${operation}.insert`, cause)));
    });

  const takeRecord = <S extends Schema.Codec<unknown, unknown>>(
    operation: string,
    kind: EphemeralKind,
    id: string,
    schema: S,
    now: number,
  ) =>
    Effect.gen(function* () {
      const key = yield* recordKey(kind, id);
      const [row] = yield* database
        .delete(ephemeralRecord)
        .where(
          and(
            eq(ephemeralRecord.key, key),
            eq(ephemeralRecord.kind, kind),
            gt(ephemeralRecord.expiresAt, now),
          ),
        )
        .returning({ payload: ephemeralRecord.payload, expiresAt: ephemeralRecord.expiresAt })
        .pipe(Effect.mapError((cause) => error(`${operation}.take`, cause)));
      if (!row) return null;
      const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(
        row.payload,
      ).pipe(Effect.mapError((cause) => error(`${operation}.decode`, cause)));
      return { payload, expiresAt: row.expiresAt };
    });

  return {
    createOtp: Effect.fn("EphemeralStore.createOtp")(function* (input) {
      const challengeId = OtpChallengeId.make(yield* keyId);
      const verifier = yield* otpVerifier(challengeId, input.code);
      yield* putRecord(
        "createOtp",
        "otp",
        challengeId,
        OtpPayload,
        { email: input.email, verifier, failures: 0 },
        input.expiresAt,
      );
      return challengeId;
    }),
    consumeOtp: Effect.fn("EphemeralStore.consumeOtp")(function* (input) {
      const key = yield* recordKey("otp", input.challengeId);
      const verifier = yield* otpVerifier(input.challengeId, input.code);
      const challenge = and(eq(ephemeralRecord.key, key), eq(ephemeralRecord.kind, "otp"));
      const [taken] = yield* runD1Batch(database, [
        database
          .delete(ephemeralRecord)
          .where(
            and(
              challenge,
              gt(ephemeralRecord.expiresAt, input.now),
              or(
                sql`${storedVerifier} = ${verifier}`,
                sql`${storedFailures} >= ${OTP_FAILURE_BUDGET - 1}`,
              ),
            ),
          )
          .returning({ payload: ephemeralRecord.payload }),
        database
          .update(ephemeralRecord)
          .set({
            payload: sql`json_set(${ephemeralRecord.payload}, '$.failures', ${storedFailures} + 1)`,
          })
          .where(challenge),
      ]).pipe(Effect.mapError((cause) => error("consumeOtp.attempt", cause)));
      const [row] = yield* Schema.decodeUnknownEffect(Schema.Array(TakenPayload))(taken ?? []).pipe(
        Effect.mapError((cause) => error("consumeOtp.row", cause)),
      );
      if (!row) return null;
      const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(OtpPayload))(
        row.payload,
      ).pipe(Effect.mapError((cause) => error("consumeOtp.decode", cause)));
      const matched = yield* crypto
        .matches(payload.verifier, verifier)
        .pipe(Effect.mapError((cause) => error("consumeOtp.compare", cause)));
      return matched ? payload.email : null;
    }),
    createOAuthState: Effect.fn("EphemeralStore.createOAuthState")(function* (input) {
      const state = yield* keyId;
      yield* putRecord(
        "createOAuthState",
        "oauth-state",
        state,
        OAuthStatePayload,
        {
          redirectUri: input.redirectUri,
          codeChallenge: input.codeChallenge,
          client: input.client,
          googleCodeVerifier: input.googleCodeVerifier,
          googleNonce: input.googleNonce,
        },
        input.expiresAt,
      );
      return state;
    }),
    consumeOAuthState: Effect.fn("EphemeralStore.consumeOAuthState")(function* (state, now) {
      const taken = yield* takeRecord(
        "consumeOAuthState",
        "oauth-state",
        state,
        OAuthStatePayload,
        now,
      );
      return taken ? { ...taken.payload, expiresAt: taken.expiresAt } : null;
    }),
    createAuthorizationGrant: Effect.fn("EphemeralStore.createAuthorizationGrant")(
      function* (input) {
        const code = AuthorizationCode.make(yield* keyId);
        yield* putRecord(
          "createAuthorizationGrant",
          "authorization",
          code,
          AuthorizationGrantPayload,
          { userId: input.userId, codeChallenge: input.codeChallenge, client: input.client },
          input.expiresAt,
        );
        return code;
      },
    ),
    consumeAuthorizationGrant: Effect.fn("EphemeralStore.consumeAuthorizationGrant")(
      function* (code, now) {
        const taken = yield* takeRecord(
          "consumeAuthorizationGrant",
          "authorization",
          code,
          AuthorizationGrantPayload,
          now,
        );
        return taken ? { ...taken.payload, expiresAt: taken.expiresAt } : null;
      },
    ),
  };
};

export const ephemeralStoreLayer = (database: D1Database, pepper: Redacted.Redacted<string>) =>
  Layer.effect(
    EphemeralStore,
    Effect.gen(function* () {
      const drizzle = yield* D1Drizzle.makeWithDefaults({});
      return EphemeralStore.of(makeEphemeralStore(drizzle, pepper, yield* AuthCrypto));
    }),
  ).pipe(Layer.provide(D1Client.layer({ db: database })), Layer.provide(AuthCrypto.layer));
