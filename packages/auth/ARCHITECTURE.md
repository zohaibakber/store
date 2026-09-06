# First-party authentication design

## Problem

Tabaaq used to delegate identity, sessions, organizations, UI state, and token
refresh to Clerk. That kept the first release small, and it also spread vendor
IDs and lifecycle rules through the API, Electron main process, React renderer,
Android app, synchronization, deployment config, and CSP.

First-party auth owns those concerns now. An authenticated organization ID
still scopes the same Postgres rows, PowerSync streams, and local replica on
every client.

## Usage (caller's view)

The shared package exposes domain values and one client service. Callers do not
handle HTTP payloads, cookies, refresh rotation, or JWT parsing.

```ts
const program = Effect.gen(function* () {
  const auth = yield* AuthClient;
  const route = yield* auth.identify({
    email: EmailAddress.make("owner@example.com"),
  });

  switch (route._tag) {
    case "Password":
      return "show-password";
    case "Otp":
      return { challengeId: route.challengeId, developmentCode: route.developmentCode };
    case "Registration":
      return "show-registration";
  }
});
```

The same operation accepts explicit credential variants. There is no options
object with `password?`, `code?`, and provider booleans.

```ts
const tokens =
  yield *
  auth.authenticate({
    _tag: "Password",
    email,
    password,
    client: nativeClient("Zohaib's Mac"),
  });

const tokens =
  yield *
  auth.authenticate({
    _tag: "Otp",
    challengeId,
    code,
    client: browserClient(),
  });
```

Google in the browser and on the desktop uses an authorization code and PKCE
between the app and the auth service. The Google client secret stays in the
Worker.

```ts
const client = nativeClient("Desktop");
const authorization =
  yield *
  auth.beginGoogle({
    redirectUri: "com.tabaaq.desktop://auth/callback",
    codeChallenge,
    client,
  });

// Open authorization.url, receive authorization code through the deep link.
const tokens =
  yield *
  auth.exchangeGoogle({
    code: callback.code,
    codeVerifier,
    client,
  });
```

Mobile presents Google's own account picker through the Google Sign-In SDK, so
there is no redirect to protect and no PKCE. The ID token Google mints is the
proof; the Worker verifies its signature, issuer, audience, and expiry with
Google before issuing the same session.

```ts
const tokens =
  yield *
  auth.exchangeGoogleIdToken({
    idToken,
    client: nativeClient("Tabaaq Mobile"),
  });
```

The API Worker only verifies access tokens. It never calls the auth Worker on a
request path.

```ts
const claims = yield * verifyAccessToken(token, { issuer, audience, publicJwk });
```

The host owns secure token storage. Electron uses `safeStorage`, Android uses
Preferences DataStore (app-private, credential-encrypted at rest on FBE), and the
browser keeps the refresh credential in an HttpOnly
SameSite cookie. An authenticated workspace snapshot supplies the organization
scope for Postgres mutations and PowerSync streams. TanStack DB owns each
client's persisted inventory collections independently of the auth lifecycle.

## Shape

### Domain types

```ts
type LoginRoute =
  | { readonly _tag: "Password"; readonly email: EmailAddress }
  | {
      readonly _tag: "Otp";
      readonly email: EmailAddress;
      readonly challengeId: OtpChallengeId;
      readonly developmentCode?: string;
    }
  | { readonly _tag: "Registration"; readonly email: EmailAddress };

type LoginCommand =
  | {
      readonly _tag: "Password";
      readonly email: EmailAddress;
      readonly password: Password;
      readonly client: AuthClientKind;
    }
  | {
      readonly _tag: "Otp";
      readonly challengeId: OtpChallengeId;
      readonly code: OtpCode;
      readonly client: AuthClientKind;
    }
  | {
      readonly _tag: "RegisterPassword";
      readonly email: EmailAddress;
      readonly name: string;
      readonly password: Password;
      readonly client: AuthClientKind;
    };

interface TokenSet {
  readonly accessToken: AccessToken;
  readonly accessExpiresAt: number;
  readonly refreshToken?: RefreshToken;
  readonly refreshExpiresAt: number;
}

interface AccessClaims {
  readonly subject: UserId;
  readonly sessionId: SessionId;
  readonly activeOrganizationId: OrganizationId;
  readonly organizationName: string;
  readonly organizationSlug: string | null;
  readonly role: OrganizationRole;
  readonly email: EmailAddress;
  readonly name: string;
  readonly image: string | null;
  readonly expiresAt: number;
}
```

Schemas decode every HTTP, D1, KV, OAuth, and JWT boundary. Branded values stop
session IDs, user IDs, and secrets from being mixed. Tagged unions make the
identifier-first and credential flows exhaustive.

### Service signatures

```ts
interface AuthClient {
  readonly identify: (input: IdentifyInput) => Effect.Effect<LoginRoute, AuthClientError>;
  readonly authenticate: (command: LoginCommand) => Effect.Effect<TokenSet, AuthClientError>;
  readonly beginGoogle: (
    input: BeginGoogleInput,
  ) => Effect.Effect<GoogleAuthorization, AuthClientError>;
  readonly exchangeGoogle: (input: ExchangeGoogleInput) => Effect.Effect<TokenSet, AuthClientError>;
  readonly exchangeGoogleIdToken: (
    input: ExchangeGoogleIdTokenInput,
  ) => Effect.Effect<TokenSet, AuthClientError>;
  readonly refresh: (input: RefreshInput) => Effect.Effect<TokenSet, AuthClientError>;
  readonly signOut: (input: SignOutInput) => Effect.Effect<void, AuthClientError>;
}

interface AuthService {
  readonly identify: (input: IdentifyInput) => Effect.Effect<LoginRoute, AuthError>;
  readonly authenticate: (command: LoginCommand) => Effect.Effect<TokenSet, AuthError>;
  readonly beginGoogle: (input: BeginGoogleInput) => Effect.Effect<GoogleAuthorization, AuthError>;
  readonly completeGoogle: (input: GoogleCallbackInput) => Effect.Effect<GoogleCallback, AuthError>;
  readonly exchangeGoogle: (input: ExchangeGoogleInput) => Effect.Effect<TokenSet, AuthError>;
  readonly exchangeGoogleIdToken: (
    input: ExchangeGoogleIdTokenInput,
  ) => Effect.Effect<TokenSet, AuthError>;
  readonly refresh: (input: RefreshInput) => Effect.Effect<TokenSet, AuthError>;
  readonly signOut: (input: SignOutInput) => Effect.Effect<void, AuthError>;
}
```

`AuthClient` is a deep module. Seven operations hide transport, validation,
refresh rotation, browser cookie policy, native token handling, provider
payloads, and error decoding. The Worker-side `AuthService` owns each complete
authentication transition. HTTP handlers only decode, call one method, and
encode.

### Storage and invariants

- D1 owns users, password credentials, OAuth accounts, organizations,
  memberships, and refresh sessions.
- A refresh token is `sessionId.secret`. D1 stores only SHA-256 of the secret.
  Rotation consumes the current session and creates its replacement in one D1
  batch. Reuse revokes the token family.
- KV owns OTP challenges, OAuth state, short-lived authorization codes, and
  rate-limit buckets. Each value is single-purpose and expires. A stale KV read
  cannot grant a long-lived session because challenge secrets and PKCE are still
  checked, and D1 creates the authoritative refresh session.
- Access tokens are short-lived ES256 JWTs. The auth Worker signs with a private
  JWK. The API and clients verify with the public JWK. Access can continue while
  offline until `exp`; refresh and sync require the network.
- A new user gets one organization in the same D1 batch. The organization ID
  directly scopes inventory rows and PowerSync streams.
- Postgres is the authoritative inventory database. Authenticated
  `/api/inventory/*` requests write to Postgres. PowerSync validates the same
  JWT and filters every TanStack DB stream by its signed organization claim.
- The browser refresh token is an HttpOnly, Secure, SameSite=Lax cookie scoped
  to the auth host. Native clients receive it in the response and store it in
  platform secure storage.
- Every cookie-authenticated mutation validates `Origin` against the explicit
  allowlist and requires JSON. Native refresh uses a bearer-like body secret and
  an allowlisted app redirect.
- `EmailProvider` is an Effect service. The initial layer logs a structured
  development event and may expose the OTP only when `AUTH_DEV_OTP=true`. It
  does not claim to deliver email.

### Module map

```text
packages/auth/src/
  model.ts             branded schemas and tagged login/token variants
  jwt.ts               ES256 issue and verify
  password.ts          password policy and PBKDF2 adapter
  client.ts            Effect AuthClient and fetch transport
  email.ts             EmailProvider contract and development layer
  security.ts          origins and native schemes

apps/auth/
  infra.ts             auth.<domain> Worker, D1, KV, secrets
  src/service.ts       complete authentication transitions
  src/repository.ts    D1 authority
  src/ephemeral.ts     expiring KV records
  src/google.ts        Google OAuth adapter
  src/http.ts          route decoding and response policy

apps/server/
  src/auth/session.ts  local public-key JWT verification and workspace projection
```

## Arena candidates

### Candidate A: opaque sessions for every request

Every client sends an opaque session token. The API calls the auth service or
reads the session database on each request. This follows the auth book most
literally and makes revocation immediate. It lost because offline verification
is impossible and the API gains a hard auth-service dependency on every sync
connection. The public interface is small, but the runtime coupling is too
large.

### Candidate B: pure JWT with rotating refresh in KV

The auth Worker issues a long-lived JWT access token plus a rotating refresh
token stored in KV. The API stays independent and the implementation is small.
It failed the consistency screen. KV can return stale values and stale negative
lookups for 60 seconds or more. Rotation replay, logout, and logout-everywhere
would have timing-dependent behavior.

### Candidate C: short JWT access plus authoritative D1 refresh session

The API verifies short access JWTs locally. D1 serializes refresh rotation and
revocation. KV carries only short-lived, single-purpose challenges. This keeps
the API independent, permits bounded offline use, and preserves server-side
session control. Its implementation has more cryptographic and storage code,
but callers see less of it.

## Synthesis decision

Candidate C is the base. Candidate A contributed separate session IDs and
secrets, hashed secrets at rest, and explicit server invalidation. Candidate B
contributed local JWT verification and PKCE-shaped native OAuth. The Better
Auth-shaped candidate contributed one shared client and a browser/native
transport split, but its plugin and callback framework was rejected. Tabaaq has
three known clients and does not need a general authentication framework.

All candidates were screened for the architect red flags. Candidate C groups
code by owned knowledge, not request order. Repository and provider adapters
add storage or protocol policy rather than forwarding methods. Storage rows and
Google response types stay private. The client and service operations each
complete a user-visible transition, so callers do not coordinate hidden stages.

## Tradeoffs accepted

- We accept access tokens remaining valid until their short expiry in exchange
  for offline verification and no auth-service call on API requests.
- We accept D1 writes on refresh in exchange for correct rotation, replay
  detection, and logout.
- We accept identifier enumeration in exchange for the required password versus
  OTP route. Per-identifier and per-challenge rate limits constrain abuse.
- We accept PBKDF2-HMAC-SHA-256 at 100,000 iterations in the first Worker
  implementation because Web Crypto supports it without native modules and
  workerd rejects higher counts. The password module isolates a future Argon2id
  service.
- We accept a development-only OTP return value while email delivery is absent.
  Production must not enable `AUTH_DEV_OTP`.

## Alternatives considered

- Opaque sessions hide token policy well but expose network availability to
  every API caller and cannot satisfy bounded offline use.
- Pure JWT reduces server state but exposes revocation and refresh-family rules
  to clients, or drops them. Long-lived bearer JWTs were rejected.
- A Better Auth-style plugin system hides provider mechanics but adds callbacks,
  hooks, and adapter contracts that no Tabaaq caller needs.

## Open questions and risks

- Which production apex should `PRODUCTION_AUTH_DOMAIN` override when it cannot
  be derived as `auth.<PRODUCTION_DOMAIN>`?
- Should a later Cloudflare Email provider send OTP through Email Routing or an
  external transactional provider bound to the Worker?

## Implementation notes and deviations

- Native hosts adopt the complete token set, not only an access token. Native
  hosts need the rotating refresh credential, and the explicit contract keeps
  token storage out of React components.
- Browser production cookies use the `__Host-` prefix and path `/`. Local HTTP
  development uses an unprefixed cookie because the prefix requires `Secure`.
- Registration and Google sign-up still create one owner organization. That
  store can invite members and manage roles through `/v1/organization`. Creating
  additional organizations, or switching among them, is intentionally absent.
- The repository pins an Effect prerelease where schema-backed errors are named
  `Schema.TaggedError`. The design's error model is unchanged.
