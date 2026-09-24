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
import { and, eq, gt, inArray, lte } from "drizzle-orm";
import * as D1Drizzle from "drizzle-orm/effect-d1";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { sha256 } from "./crypto";

const OtpPayload = Schema.Struct({
  email: EmailAddress,
});

const OAuthStatePayload = Schema.Struct({
  redirectUri: Schema.String,
  codeChallenge: Schema.String,
  client: AuthClientKind,
});
export interface OAuthStateRecord extends Schema.Schema.Type<typeof OAuthStatePayload> {
  readonly expiresAt: number;
}

const AuthorizationGrantPayload = Schema.Struct({
  userId: UserId,
  codeChallenge: Schema.String,
  client: AuthClientKind,
});
export interface AuthorizationGrantRecord extends Schema.Schema.Type<
  typeof AuthorizationGrantPayload
> {
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

type AuthDrizzle = Effect.Success<ReturnType<typeof D1Drizzle.makeWithDefaults>>;

export const EXPIRED_SWEEP_LIMIT = 32;

const error = (operation: string, cause: unknown) =>
  new EphemeralStoreError({ operation, message: String(cause), cause });

const keyId = () => crypto.randomUUID();

const makeEphemeralStore = (database: AuthDrizzle, pepper: string): EphemeralStoreApi => {
  const client = database.$client;

  const recordKey = (kind: EphemeralKind, id: string) =>
    sha256(`${pepper}:${kind}:${id}`).pipe(Effect.mapError((cause) => error("digest", cause)));

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
      const statements = [
        sweepExpired(now),
        database
          .insert(ephemeralRecord)
          .values({ key, kind, payload: encoded, expiresAt, createdAt: now }),
      ].map((query) => {
        const compiled = query.toSQL();
        return client.unsafe(compiled.sql, compiled.params);
      });
      yield* client
        .batch(statements)
        .pipe(Effect.mapError((cause) => error(`${operation}.insert`, cause)));
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
      const challengeId = OtpChallengeId.make(keyId());
      yield* putRecord(
        "createOtp",
        "otp",
        `${challengeId}:${input.code}`,
        OtpPayload,
        { email: input.email },
        input.expiresAt,
      );
      return challengeId;
    }),
    consumeOtp: Effect.fn("EphemeralStore.consumeOtp")(function* (input) {
      const taken = yield* takeRecord(
        "consumeOtp",
        "otp",
        `${input.challengeId}:${input.code}`,
        OtpPayload,
        input.now,
      );
      return taken?.payload.email ?? null;
    }),
    createOAuthState: Effect.fn("EphemeralStore.createOAuthState")(function* (input) {
      const state = keyId();
      yield* putRecord(
        "createOAuthState",
        "oauth-state",
        state,
        OAuthStatePayload,
        {
          redirectUri: input.redirectUri,
          codeChallenge: input.codeChallenge,
          client: input.client,
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
        const code = AuthorizationCode.make(keyId());
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

export const ephemeralStoreLayer = (database: D1Database, pepper: string) =>
  Layer.effect(
    EphemeralStore,
    Effect.map(D1Drizzle.makeWithDefaults({}), (drizzle) =>
      EphemeralStore.of(makeEphemeralStore(drizzle, pepper)),
    ),
  ).pipe(Layer.provide(D1Client.layer({ db: database })));
