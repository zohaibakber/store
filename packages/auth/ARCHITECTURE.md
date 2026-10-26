# Authentication design

## Scope

Tabaaq owns identity, sessions, organizations, and token refresh. The auth
Worker issues tokens; the API and the Electron app consume them. An
authenticated organization ID scopes the organization authority and the local replica.

## Usage (caller's view)

The shared package exposes domain values and one client service. Callers do not
handle HTTP payloads, refresh rotation, or JWT parsing.

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
    client: nativeClient("Front counter"),
  });
```

Google on the desktop uses an authorization code and PKCE
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

The API Worker only verifies access tokens. It never calls the auth Worker on a
request path.

```ts
const claims = yield * verifyAccessToken(token, { keys });
```

Electron main stores the refresh token with `safeStorage`. An authenticated workspace snapshot supplies the organization
scope for authority commands and replica sync. The replica owns each
client's persisted inventory independently of the auth lifecycle.

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
  readonly refresh: (input: RefreshInput) => Effect.Effect<TokenSet, AuthClientError>;
  readonly signOut: (input: SignOutInput) => Effect.Effect<void, AuthClientError>;
}

interface AuthService {
  readonly identify: (input: IdentifyInput) => Effect.Effect<LoginRoute, AuthError>;
  readonly authenticate: (command: LoginCommand) => Effect.Effect<TokenSet, AuthError>;
  readonly beginGoogle: (input: BeginGoogleInput) => Effect.Effect<GoogleAuthorization, AuthError>;
  readonly completeGoogle: (input: GoogleCallbackInput) => Effect.Effect<GoogleCallback, AuthError>;
  readonly exchangeGoogle: (input: ExchangeGoogleInput) => Effect.Effect<TokenSet, AuthError>;
  readonly refresh: (input: RefreshInput) => Effect.Effect<TokenSet, AuthError>;
  readonly signOut: (input: SignOutInput) => Effect.Effect<void, AuthError>;
}
```

`AuthClient` is a deep module. Its operations hide transport, validation,
refresh rotation, provider payloads, and error decoding.
The Worker-side `AuthService` owns each complete
authentication transition. HTTP handlers only decode, call one method, and
encode.

### Storage and invariants

- D1 owns users, password credentials, OAuth accounts, organizations,
  memberships, and refresh sessions.
- A refresh token is `sessionId.secret` with a 32-byte random secret. D1 stores
  only `SHA-256("refresh:" + secret)`; an invitation token is stored as
  `SHA-256("invite:" + token)`. A pepper adds nothing against a 256-bit secret.
  Rotation consumes the current session and creates its replacement in one D1
  batch. A consumed token presented again within 90 seconds rotates the
  family's live session: that is a client retrying after a lost response.
  Presented later, it revokes the token family. Sign-out revokes the family.
- D1 `auth_ephemeral_record` owns OTP challenges, OAuth state, and
  short-lived authorization codes. The row key is a SHA-256, peppered with the
  Alchemy-generated `AUTH_EPHEMERAL_SECRET`, of the
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
  count. Issuance in local development is unmetered. Every insert shares a
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
- Access tokens are short-lived ES256 JWTs. Alchemy generates the P-256 key pair
  per stage (`AuthSigningKeyPair` in `packages/db/src/auth/infra.ts`) and binds
  the PEMs to the auth Worker and the public PEM to the API Worker. The key id is
  the RFC 7638 thumbprint, so a new key pair changes it. Issuer `tabaaq-auth` and
  audience `tabaaq-api` are fixed in `jwt.ts`, so the API needs no auth URL.
  Access can continue while
  offline until `exp`; refresh and sync require the network.
- A new user gets one organization in the same D1 batch. The organization ID
  directly scopes inventory rows and replica sync. A new session opens the
  membership the user joined most recently.
- The organization's `OrgAuthority` Durable Object is the authoritative
  inventory store. Authenticated `/api/sync/*` requests commit there. The API validates the same JWT and
  filters every replica stream by its signed organization claim.
- The desktop is the only client. It receives the refresh token in the response
  body and stores it with `safeStorage`; there is no cookie flow and no CORS.
  Google redirects must use the `com.tabaaq.desktop:` scheme.
- `EmailProvider` is an Effect service. Under `alchemy dev` the development
  layer returns the OTP in the response; deployed stages use the disabled
  layer. It does not claim to deliver email.

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
  security.ts          desktop scheme and redirect check

apps/auth/
  infra.ts             auth.<domain> Worker, D1, generated key bindings
  src/service.ts       AuthService layer composing login/session/google/org ops
  src/crypto.ts        token hashes, OTP, refresh token parsing
  src/d1.ts            the one D1 client and atomic batches
  src/repository.ts    D1 authority
  src/ephemeral.ts     single-use expiring D1 records
  src/google.ts        Google OAuth adapter
  src/http.ts          HttpApiBuilder handlers

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
  It is tied to `alchemy dev`, so no deployed stage can enable it.
- We accept that losing Alchemy state, or replacing `AuthSigningKeyPair`,
  rotates the signing key and the ephemeral secret. Access tokens then fail
  verification and clients refresh; ephemeral records lapse within minutes.

## Alternatives considered

- Opaque sessions hide token policy well but expose network availability to
  every API caller and cannot satisfy bounded offline use.
- Pure JWT reduces server state but exposes revocation and refresh-family rules
  to clients, or drops them. Long-lived bearer JWTs were rejected.
- A Better Auth-style plugin system hides provider mechanics but adds callbacks,
  hooks, and adapter contracts that no Tabaaq caller needs.

## Open questions and risks

- Should a later Cloudflare Email provider send OTP through Email Routing or an
  external transactional provider bound to the Worker?

## Implementation notes and deviations

- Native hosts adopt the complete token set, not only an access token. Native
  hosts need the rotating refresh credential, and the explicit contract keeps
  token storage out of React components.
- Registration and Google sign-up still create one owner organization. That
  store can invite members and manage roles through `/v1/organization`. Creating
  additional organizations, or switching among them, is intentionally absent.
- The repository pins an Effect prerelease where schema-backed errors are named
  `Schema.TaggedError`. The design's error model is unchanged.
