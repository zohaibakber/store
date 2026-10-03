# Authentication design

## Scope

Tabaaq owns identity, sessions, organizations, and token refresh. The auth
Worker issues tokens; the API, the Electron main process, the web renderer, and
the Android app consume them. An authenticated organization ID scopes the same
Postgres rows and local replica on every client.

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
scope for Postgres mutations and replica sync. TanStack DB owns each
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
  readonly role: OrganizationRole;
  readonly email: EmailAddress;
  readonly name: string;
  readonly image: string | null;
  readonly expiresAt: number;
}
```

Schemas decode every HTTP, D1, OAuth, and JWT boundary. Branded values stop
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
  batch. A consumed token presented again within 90 seconds rotates the
  family's live session: that is a client retrying after a lost response.
  Presented later, it revokes the token family. Sign-out revokes the family.
- D1 `auth_ephemeral_record` owns OTP challenges, OAuth state, and
  short-lived authorization codes. The row key is a peppered SHA-256 of the
  record kind and identifier. Consumption is one
  `DELETE ... WHERE key = ? AND kind = ? AND expiresAt > ? RETURNING payload`
  statement. D1 serializes writes, so concurrent consumers of the same record
  get exactly one row. An OTP row holds an HMAC of the challenge ID and code
  plus a failure count, so D1 never holds a usable code. One batch deletes the
  row on a match or on the fifth attempt and otherwise counts the failure, so a
  challenge allows five guesses. An `otp-issuance` row per address records the
  latest challenge and the hour's count. Issuing is one batch that swaps that
  row by compare-and-set and inserts the new challenge only if the swap won.
  An earlier challenge stays valid until it expires, so a second request cannot
  cancel a code already in the inbox. While the latest challenge is live, a
  request within 30 seconds or past the fifth issue in an hour returns that
  challenge without sending again. Past the fifth issue with no live challenge
  the request is refused. A failed delivery retracts the challenge and its
  count. Issuance under `AUTH_DEV_OTP` is unmetered. Every insert shares a
  batch with a bounded sweep of expired rows. Payloads are JSON encoded and
  decoded through Effect Schema.
- Login, OTP, registration, Google identity, and invitation attempts use the
  same Cloudflare Workers rate-limit bindings as the API worker. Counters are
  per location and the window is 10 or 60 seconds. Identify, sign-in, sign-up
  and the Google start, callback and exchange routes are also limited to 60
  requests a minute per caller: the `CF-Connecting-IP` address, or its /64 for
  IPv6. Refresh and sign-out are not.
- A password is `Redacted` from the HTTP decode to the hasher. Sign-in accepts
  any password up to 256 characters, so the registration policy can tighten
  without locking anyone out. A stored hash below the current cost still
  verifies and is replaced on that sign-in by compare-and-set.
- A Google identity attaches to an existing account by email only when Google
  owns the mailbox: a `gmail.com` address or a non-empty Workspace `hd` claim.
  Any other verified email creates a new account or is refused.
- Access tokens are short-lived ES256 JWTs. The auth Worker signs with a private
  JWK. The API and clients verify with the public JWK. Access can continue while
  offline until `exp`; refresh and sync require the network.
- A new user gets one organization in the same D1 batch. The organization ID
  directly scopes inventory rows and replica sync. A new session opens the
  membership the user joined most recently.
- Postgres is the authoritative inventory database. Authenticated
  `/api/sync/*` requests write to Postgres. The API validates the same JWT and
  filters every replica stream by its signed organization claim.
- The browser refresh token is an HttpOnly, Secure, SameSite=Lax cookie scoped
  to the auth host. Native clients receive it in the response and store it in
  platform secure storage.
- The browser clears its session before it asks the Worker to revoke the
  cookie. If that request fails or takes over ten seconds it leaves a hint in
  local storage. A start that finds the hint opens signed out and retries in
  the background, until the request succeeds or the user signs in again. A
  refresh in another tab does not clear the hint.
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
  jwt.ts               ES256 issue/verify and public JWKS document
  password.ts          password policy and PBKDF2 adapter
  http-api.ts          AuthHttpApi groups (system / session / organization)
  http-errors.ts       public HTTP error schemas shared by Worker and client
  client.ts            Effect AuthClient over HttpApiClient
  email.ts             EmailProvider contract and development layer
  security.ts          origins and native schemes

apps/auth/
  infra.ts             auth.<domain> Worker, D1, secrets
  src/service.ts       AuthService layer composing login/session/google/org ops
  src/crypto.ts        peppered hashes, OTP, refresh token parsing
  src/d1.ts            the one D1 client and atomic batches
  src/repository.ts    D1 authority
  src/ephemeral.ts     single-use expiring D1 records
  src/google.ts        Google OAuth adapter
  src/http.ts          HttpApiBuilder handlers and cookie/CORS policy

apps/server/
  src/auth/session.ts  local public-key JWT verification and workspace projection
```

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
- We accept that anyone who knows an address can spend its five codes for the
  hour, in exchange for a bound on the mail one address can be sent. No
  production layer delivers OTP yet, so this applies once one does.
- We accept that a new session opens the most recently joined organization and
  that nothing switches organizations yet, so an owner who accepts an
  invitation cannot reach their first organization until that exists.
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
