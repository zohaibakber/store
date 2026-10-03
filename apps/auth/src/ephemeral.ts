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
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { AuthCrypto } from "./crypto";
import { AuthD1, bound, runD1Batch, type AuthDrizzle } from "./d1";
import { storageFailureMessage } from "./errors";

const OTP_FAILURE_BUDGET = 5;
const OTP_REISSUE_COOLDOWN_MS = 30_000;
const OTP_ISSUE_WINDOW_MS = 60 * 60 * 1_000;
const OTP_ISSUES_PER_WINDOW = 5;

const OtpPayload = Schema.Struct({
  email: EmailAddress,
  verifier: Schema.String,
  failures: Schema.Int,
});

const OtpIssuance = Schema.Struct({
  challengeId: OtpChallengeId,
  challengeKey: Schema.String,
  issuedAt: Schema.Int,
  windowStartedAt: Schema.Int,
  issued: Schema.Int,
});

const OtpIssuanceJson = Schema.fromJsonString(OtpIssuance);
const decodeIssuance = Schema.decodeEffect(OtpIssuanceJson);
const encodeIssuance = Schema.encodeEffect(OtpIssuanceJson);
const encodeOtp = Schema.encodeEffect(Schema.fromJsonString(OtpPayload));

export type OtpIssue =
  | { readonly _tag: "Issued"; readonly challengeId: OtpChallengeIdType }
  | { readonly _tag: "Pending"; readonly challengeId: OtpChallengeIdType }
  | { readonly _tag: "Exhausted" };

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

export class EphemeralStore extends Context.Service<
  EphemeralStore,
  {
    readonly issueOtp: (input: {
      readonly email: EmailAddressType;
      readonly code: OtpCode;
      readonly expiresAt: number;
      readonly metered: boolean;
    }) => Effect.Effect<OtpIssue, EphemeralStoreError>;
    readonly retractOtp: (input: {
      readonly email: EmailAddressType;
      readonly challengeId: OtpChallengeIdType;
    }) => Effect.Effect<void, EphemeralStoreError>;
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
>()("@store/auth-worker/EphemeralStore") {
  static readonly layer = (pepper: Redacted.Redacted<string>) =>
    Layer.effect(
      EphemeralStore,
      Effect.gen(function* () {
        const database = yield* AuthD1;
        const crypto = yield* AuthCrypto;
        return EphemeralStore.of(makeEphemeralStore(database, pepper, crypto));
      }),
    );
}

type EphemeralKind = typeof ephemeralRecord.$inferSelect.kind;

const EXPIRED_SWEEP_LIMIT = 32;

const error = (operation: string, cause: unknown) =>
  new EphemeralStoreError({ operation, message: storageFailureMessage(cause), cause });

const makeEphemeralStore = (
  database: AuthDrizzle,
  pepper: Redacted.Redacted<string>,
  crypto: AuthCrypto["Service"],
): EphemeralStore["Service"] => {
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

  const currentIssuance = Effect.fnUntraced(function* (key: string, now: number) {
    const [row] = yield* database
      .select({ payload: ephemeralRecord.payload })
      .from(ephemeralRecord)
      .where(
        and(
          eq(ephemeralRecord.key, key),
          eq(ephemeralRecord.kind, "otp-issuance"),
          gt(ephemeralRecord.expiresAt, now),
        ),
      )
      .pipe(Effect.mapError((cause) => error("issueOtp.read", cause)));
    if (!row) return null;
    const issuance = yield* decodeIssuance(row.payload).pipe(
      Effect.mapError((cause) => error("issueOtp.decode", cause)),
    );
    return { payload: row.payload, issuance };
  });

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
    issueOtp: Effect.fn("EphemeralStore.issueOtp")(function* (input) {
      const now = yield* Clock.currentTimeMillis;
      const issuanceKey = yield* recordKey("otp-issuance", input.email);
      const previous = yield* currentIssuance(issuanceKey, now);
      const inWindow =
        previous !== null && previous.issuance.windowStartedAt + OTP_ISSUE_WINDOW_MS > now;
      if (input.metered && previous) {
        const cooling = previous.issuance.issuedAt + OTP_REISSUE_COOLDOWN_MS > now;
        const spent = inWindow && previous.issuance.issued >= OTP_ISSUES_PER_WINDOW;
        if (cooling || spent) {
          const [live] = yield* database
            .select({ key: ephemeralRecord.key })
            .from(ephemeralRecord)
            .where(
              and(
                eq(ephemeralRecord.key, previous.issuance.challengeKey),
                eq(ephemeralRecord.kind, "otp"),
                gt(ephemeralRecord.expiresAt, now),
              ),
            )
            .pipe(Effect.mapError((cause) => error("issueOtp.pending", cause)));
          if (live) return { _tag: "Pending", challengeId: previous.issuance.challengeId };
          if (spent) return { _tag: "Exhausted" };
        }
      }
      const challengeId = OtpChallengeId.make(yield* keyId);
      const challengeKey = yield* recordKey("otp", challengeId);
      const verifier = yield* otpVerifier(challengeId, input.code);
      const windowStartedAt = inWindow ? previous.issuance.windowStartedAt : now;
      const issuance = yield* encodeIssuance({
        challengeId,
        challengeKey,
        issuedAt: now,
        windowStartedAt,
        issued: inWindow ? previous.issuance.issued + 1 : 1,
      }).pipe(Effect.mapError((cause) => error("issueOtp.encode", cause)));
      const challenge = yield* encodeOtp({ email: input.email, verifier, failures: 0 }).pipe(
        Effect.mapError((cause) => error("issueOtp.encode", cause)),
      );
      const superseded = lte(ephemeralRecord.expiresAt, now);
      const results = yield* runD1Batch(database, [
        sweepExpired(now),
        database
          .insert(ephemeralRecord)
          .values({
            key: issuanceKey,
            kind: "otp-issuance",
            payload: issuance,
            expiresAt: Math.max(windowStartedAt + OTP_ISSUE_WINDOW_MS, input.expiresAt),
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: ephemeralRecord.key,
            set: {
              payload: sql`excluded.payload`,
              expiresAt: sql`excluded.expiresAt`,
              createdAt: sql`excluded.createdAt`,
            },
            setWhere: previous
              ? or(eq(ephemeralRecord.payload, previous.payload), superseded)
              : superseded,
          })
          .returning({ key: ephemeralRecord.key }),
        database.insert(ephemeralRecord).select((query) =>
          query
            .select({
              key: bound(ephemeralRecord.key, challengeKey),
              kind: bound(ephemeralRecord.kind, "otp"),
              payload: bound(ephemeralRecord.payload, challenge),
              expiresAt: bound(ephemeralRecord.expiresAt, input.expiresAt),
              createdAt: bound(ephemeralRecord.createdAt, now),
            })
            .from(ephemeralRecord)
            .where(
              and(eq(ephemeralRecord.key, issuanceKey), eq(ephemeralRecord.payload, issuance)),
            ),
        ),
      ]).pipe(Effect.mapError((cause) => error("issueOtp.insert", cause)));
      if ((results[1]?.length ?? 0) === 1) return { _tag: "Issued", challengeId };
      const winner = yield* currentIssuance(issuanceKey, now);
      return winner
        ? { _tag: "Pending", challengeId: winner.issuance.challengeId }
        : { _tag: "Exhausted" };
    }),
    retractOtp: Effect.fn("EphemeralStore.retractOtp")(function* (input) {
      const issuanceKey = yield* recordKey("otp-issuance", input.email);
      const challengeKey = yield* recordKey("otp", input.challengeId);
      yield* runD1Batch(database, [
        database
          .delete(ephemeralRecord)
          .where(and(eq(ephemeralRecord.key, challengeKey), eq(ephemeralRecord.kind, "otp"))),
        database
          .update(ephemeralRecord)
          .set({
            payload: sql`json_set(${ephemeralRecord.payload}, '$.issued', json_extract(${ephemeralRecord.payload}, '$.issued') - 1)`,
          })
          .where(
            and(
              eq(ephemeralRecord.key, issuanceKey),
              eq(ephemeralRecord.kind, "otp-issuance"),
              sql`json_extract(${ephemeralRecord.payload}, '$.challengeKey') = ${challengeKey}`,
            ),
          ),
      ]).pipe(Effect.mapError((cause) => error("retractOtp", cause)));
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
