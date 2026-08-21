import type { KVNamespace } from "@cloudflare/workers-types";
import {
  AuthorizationCode,
  EmailAddress,
  OtpChallengeId,
  UserId,
  type AuthClientKind,
  type AuthorizationCode as AuthorizationCodeType,
  type EmailAddress as EmailAddressType,
  type OtpChallengeId as OtpChallengeIdType,
  type OtpCode,
  type UserId as UserIdType,
} from "@store/auth";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

const textEncoder = new TextEncoder();

const OtpRecord = Schema.Struct({
  email: EmailAddress,
  codeHash: Schema.String,
  expiresAt: Schema.Number,
});

const OAuthStateRecord = Schema.Struct({
  redirectUri: Schema.String,
  codeChallenge: Schema.String,
  client: Schema.Union([
    Schema.Struct({ _tag: Schema.Literal("Browser") }),
    Schema.Struct({ _tag: Schema.Literal("Native"), deviceName: Schema.String }),
  ]),
  expiresAt: Schema.Number,
});
export interface OAuthStateRecord extends Schema.Schema.Type<typeof OAuthStateRecord> {}

const AuthorizationGrantRecord = Schema.Struct({
  userId: UserId,
  codeChallenge: Schema.String,
  client: Schema.Union([
    Schema.Struct({ _tag: Schema.Literal("Browser") }),
    Schema.Struct({ _tag: Schema.Literal("Native"), deviceName: Schema.String }),
  ]),
  expiresAt: Schema.Number,
});
export interface AuthorizationGrantRecord extends Schema.Schema.Type<
  typeof AuthorizationGrantRecord
> {}

const RateLimitRecord = Schema.Struct({
  count: Schema.Number,
  expiresAt: Schema.Number,
});

export class EphemeralStoreError extends Schema.TaggedError<EphemeralStoreError>()(
  "Auth.EphemeralStoreError",
  {
    operation: Schema.String,
    message: Schema.String,
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
  readonly allow: (input: {
    readonly key: string;
    readonly limit: number;
    readonly windowSeconds: number;
    readonly now: number;
  }) => Effect.Effect<boolean, EphemeralStoreError>;
}

export class EphemeralStore extends Context.Service<EphemeralStore, EphemeralStoreApi>()(
  "@store/auth-worker/EphemeralStore",
) {}

const error = (operation: string, cause: unknown) =>
  new EphemeralStoreError({ operation, message: String(cause) });

/**
 * Cloudflare KV refuses `expiration`/`expirationTtl` under 60 seconds. Identify
 * and native Google rate-limit with a 60-second window, so flooring that window
 * to an absolute timestamp often lands at 59s remaining and the put throws.
 * KV TTL is only garbage collection: the JSON `expiresAt` is the real window.
 */
export const kvExpirationTtlSeconds = (expiresAtMs: number, nowMs: number) =>
  Math.max(Math.ceil((expiresAtMs - nowMs) / 1_000), 60) + 1;

const digest = (value: string) =>
  Effect.tryPromise({
    try: async () => {
      const bytes = new Uint8Array(
        await crypto.subtle.digest("SHA-256", textEncoder.encode(value)),
      );
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
    },
    catch: (cause) => error("digest", cause),
  });

const keyId = () => crypto.randomUUID();

export const ephemeralStoreLayer = (namespace: KVNamespace, pepper: string) =>
  Layer.succeed(
    EphemeralStore,
    EphemeralStore.of({
      createOtp: Effect.fn("EphemeralStore.createOtp")(function* (input) {
        const challengeId = OtpChallengeId.make(keyId());
        const codeHash = yield* digest(`${pepper}:${challengeId}:${input.code}`);
        yield* Effect.tryPromise({
          try: () =>
            namespace.put(
              `otp:${challengeId}`,
              JSON.stringify({
                email: input.email,
                codeHash,
                expiresAt: input.expiresAt,
              } satisfies typeof OtpRecord.Type),
              { expirationTtl: kvExpirationTtlSeconds(input.expiresAt, Date.now()) },
            ),
          catch: (cause) => error("createOtp", cause),
        });
        return challengeId;
      }),
      consumeOtp: Effect.fn("EphemeralStore.consumeOtp")(function* (input) {
        const raw = yield* Effect.tryPromise({
          try: () => namespace.get(`otp:${input.challengeId}`, "json"),
          catch: (cause) => error("consumeOtp.get", cause),
        });
        if (raw === null) return null;
        const record = yield* Schema.decodeUnknownEffect(OtpRecord)(raw).pipe(
          Effect.mapError((cause) => error("consumeOtp.decode", cause)),
        );
        const codeHash = yield* digest(`${pepper}:${input.challengeId}:${input.code}`);
        if (record.expiresAt <= input.now || codeHash !== record.codeHash) return null;
        yield* Effect.tryPromise({
          try: () => namespace.delete(`otp:${input.challengeId}`),
          catch: (cause) => error("consumeOtp.delete", cause),
        });
        return record.email;
      }),
      createOAuthState: Effect.fn("EphemeralStore.createOAuthState")(function* (input) {
        const state = keyId();
        yield* Effect.tryPromise({
          try: () =>
            namespace.put(`oauth-state:${state}`, JSON.stringify(input), {
              expirationTtl: kvExpirationTtlSeconds(input.expiresAt, Date.now()),
            }),
          catch: (cause) => error("createOAuthState", cause),
        });
        return state;
      }),
      consumeOAuthState: Effect.fn("EphemeralStore.consumeOAuthState")(function* (state, now) {
        const raw = yield* Effect.tryPromise({
          try: () => namespace.get(`oauth-state:${state}`, "json"),
          catch: (cause) => error("consumeOAuthState.get", cause),
        });
        if (raw === null) return null;
        const record = yield* Schema.decodeUnknownEffect(OAuthStateRecord)(raw).pipe(
          Effect.mapError((cause) => error("consumeOAuthState.decode", cause)),
        );
        if (record.expiresAt <= now) return null;
        yield* Effect.tryPromise({
          try: () => namespace.delete(`oauth-state:${state}`),
          catch: (cause) => error("consumeOAuthState.delete", cause),
        });
        return record;
      }),
      createAuthorizationGrant: Effect.fn("EphemeralStore.createAuthorizationGrant")(
        function* (input) {
          const code = AuthorizationCode.make(keyId());
          yield* Effect.tryPromise({
            try: () =>
              namespace.put(`authorization:${code}`, JSON.stringify(input), {
                expirationTtl: kvExpirationTtlSeconds(input.expiresAt, Date.now()),
              }),
            catch: (cause) => error("createAuthorizationGrant", cause),
          });
          return code;
        },
      ),
      consumeAuthorizationGrant: Effect.fn("EphemeralStore.consumeAuthorizationGrant")(
        function* (code, now) {
          const raw = yield* Effect.tryPromise({
            try: () => namespace.get(`authorization:${code}`, "json"),
            catch: (cause) => error("consumeAuthorizationGrant.get", cause),
          });
          if (raw === null) return null;
          const record = yield* Schema.decodeUnknownEffect(AuthorizationGrantRecord)(raw).pipe(
            Effect.mapError((cause) => error("consumeAuthorizationGrant.decode", cause)),
          );
          if (record.expiresAt <= now) return null;
          yield* Effect.tryPromise({
            try: () => namespace.delete(`authorization:${code}`),
            catch: (cause) => error("consumeAuthorizationGrant.delete", cause),
          });
          return record;
        },
      ),
      allow: Effect.fn("EphemeralStore.allow")(function* (input) {
        const key = `rate:${input.key}`;
        const raw = yield* Effect.tryPromise({
          try: () => namespace.get(key, "json"),
          catch: (cause) => error("allow.get", cause),
        });
        const current =
          raw === null
            ? null
            : yield* Schema.decodeUnknownEffect(RateLimitRecord)(raw).pipe(
                Effect.mapError((cause) => error("allow.decode", cause)),
              );
        if (current && current.expiresAt > input.now && current.count >= input.limit) {
          return false;
        }
        const expiresAt =
          current && current.expiresAt > input.now
            ? current.expiresAt
            : input.now + input.windowSeconds * 1_000;
        const count = current && current.expiresAt > input.now ? current.count + 1 : 1;
        yield* Effect.tryPromise({
          try: () =>
            namespace.put(key, JSON.stringify({ count, expiresAt }), {
              expirationTtl: kvExpirationTtlSeconds(expiresAt, input.now),
            }),
          catch: (cause) => error("allow.put", cause),
        });
        return true;
      }),
    }),
  );
