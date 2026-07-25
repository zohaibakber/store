# Plan 016: Stop shipping `http://localhost:5173` as a production trusted origin

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8b1efa49..HEAD -- apps/server/wrangler.jsonc apps/server/src/http/app.ts apps/server/src/runtime/worker.ts packages/auth/src/auth.ts apps/server/src/testing/app.ts`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `8b1efa49`, 2026-07-25

## Why this matters

`AUTH_TRUSTED_ORIGINS` is committed as `"http://localhost:5173"` in the
**top-level** `vars` block of `apps/server/wrangler.jsonc`. There is no
environment override, so that is the value the deployed production Worker
runs with.

That single string feeds two separate trust decisions:

1. **CORS** — `http/app.ts:19-23` reflects any listed origin back in
   `Access-Control-Allow-Origin` with `credentials: true`.
2. **Better Auth's origin/CSRF check** — `packages/auth/src/auth.ts:15-16`
   passes the same list to `betterAuth({ trustedOrigins })`.

The consequence: any page a user loads from `http://localhost:5173` — a Vite
dev server, or any other locally-running app that happens to bind that very
common port — can make credentialed cross-origin requests to the production
API and satisfy **both** checks, reading and writing that user's organization
data. This is a realistic exposure for a desktop product whose users are also
developers or who run other local tooling.

The desktop app itself does **not** need this entry: its origin is added
separately from `ELECTRON_PROTOCOL` (`auth.ts:15`,
`` `${config.electronProtocol}:/` ``). So production can run with an empty
list, and localhost stays a local-development-only override.

## Current state

### The committed configuration

`apps/server/wrangler.jsonc:18-21`:

```jsonc
  "vars": {
    "AUTH_TRUSTED_ORIGINS": "http://localhost:5173",
    "ELECTRON_PROTOCOL": "com.tabaaq.desktop",
  },
```

There is no `env` block anywhere in that file, so `wrangler deploy` uses these
values in production.

### How the value is consumed

`apps/server/src/runtime/worker.ts:8-12` and `:35-48`:

```ts
const commaSeparated = (value: string): ReadonlyArray<string> =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
```

```ts
const trustedOrigins = commaSeparated(c.env.AUTH_TRUSTED_ORIGINS);
const auth = makeAuth({
  baseURL: new URL(c.req.url).origin,
  database: authDatabase,
  electronProtocol: c.env.ELECTRON_PROTOCOL,
  secret: c.env.BETTER_AUTH_SECRET,
  trustedOrigins,
});
```

```ts
c.set("trustedOrigins", trustedOrigins);
```

Note `commaSeparated` already handles the empty string safely: `"".split(",")`
gives `[""]`, and `.filter(Boolean)` removes it, yielding `[]`. **An empty
value is valid and means "no extra browser origins".**

`apps/server/src/http/app.ts:15-24`:

```ts
api.use(
  "*",
  cors({
    origin: (origin, c) => (c.var.trustedOrigins.includes(origin) ? origin : ""),
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }),
);
```

`packages/auth/src/auth.ts:14-16`:

```ts
export const makeAuth = (config: AuthConfig) => {
  const trustedOrigins = [config.baseURL, ...config.trustedOrigins, `${config.electronProtocol}:/`];
```

So the Worker's own origin and the Electron protocol origin are **always**
trusted regardless of this variable. Only extra browser origins come from
`AUTH_TRUSTED_ORIGINS`.

### The test harness

`apps/server/src/testing/app.ts:56-78` — `appFor(member, authenticated, runSync)`
builds the real Hono app with a stub runtime middleware. It currently hardcodes:

```ts
c.set("trustedOrigins", ["http://localhost:5173"]);
```

Existing route tests (`apps/server/src/routes/uploads.test.ts`,
`apps/server/src/routes/sync.test.ts`) drive the app through
`appFor(...).request(path, init, env)`. Model the new CORS test on
`uploads.test.ts`'s structure (plain `vitest`, `describe`/`it`, direct
`app.request` calls).

### Conventions

- `apps/server` is Effect-based in its sync layer, but this plan touches only
  Hono middleware wiring, JSON config, and a plain vitest test. Do **not**
  introduce Effect here.
- CI writes an `apps/server/.env` with an empty `AUTH_TRUSTED_ORIGINS=`
  (`.github/workflows/ci.yml`), which is consistent with the production value
  this plan establishes.

## Commands you will need

| Purpose               | Command                                                          | Expected on success |
| --------------------- | ---------------------------------------------------------------- | ------------------- |
| Format/lint/typecheck | `bunx vp check`                                                  | exit 0              |
| Server tests          | `bunx vp test apps/server`                                       | exit 0, all pass    |
| Full tests            | `bunx vp test`                                                   | exit 0              |
| Workspace checks      | `bun run check`                                                  | exit 0              |
| Config sanity         | `cd apps/server && bunx wrangler deploy --dry-run --outdir dist` | exit 0              |

## Scope

**In scope**:

- `apps/server/wrangler.jsonc`
- `apps/server/src/testing/app.ts` (make `trustedOrigins` injectable)
- `apps/server/src/routes/cors.test.ts` (create)
- `apps/server/README.md` (document the variable and the dev override)

**Out of scope** (do NOT touch):

- `apps/server/src/http/app.ts` — the CORS callback is already correct; it
  faithfully reflects whatever list it is given. The bug is the _value_, not
  the logic. Do not "harden" the callback.
- `packages/auth/src/auth.ts` — the composition of `baseURL` +
  configured origins + electron protocol is correct and deliberate.
- `apps/server/src/auth/electron-origin.ts` — the `Origin: null` acceptance
  there is a separate, known finding with its own trade-offs. Not this plan.
- Any secret value. Never write a real secret into `wrangler.jsonc`, the
  README, or a test.

## Git workflow

- Branch: `advisor/016-scope-trusted-origins`
- Commit per step is fine. Message style matches `git log` (short imperative,
  no prefix), e.g. `Scope AUTH_TRUSTED_ORIGINS to local development`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Empty the production value in `wrangler.jsonc`

Change the top-level `vars` block so `AUTH_TRUSTED_ORIGINS` is an empty string:

```jsonc
  "vars": {
    "AUTH_TRUSTED_ORIGINS": "",
    "ELECTRON_PROTOCOL": "com.tabaaq.desktop",
  },
```

Add a short JSONC comment directly above it stating that browser origins are
opt-in per environment, that the Worker's own origin and the Electron protocol
origin are always trusted, and that local browser development should set the
value in `apps/server/.dev.vars` rather than here.

Leave `ELECTRON_PROTOCOL` exactly as it is.

**Verify**: `grep -n 'localhost' apps/server/wrangler.jsonc` → no matches.

### Step 2: Provide the local development override

`wrangler dev` reads `apps/server/.dev.vars` and its values take precedence
over `wrangler.jsonc` `vars`. `.dev.vars` is gitignored, so it cannot be
committed — document it instead.

In `apps/server/README.md`, add a short subsection covering:

- `AUTH_TRUSTED_ORIGINS` is a comma-separated list of **extra browser origins**;
  empty is the correct production value.
- For browser-based local development, put
  `AUTH_TRUSTED_ORIGINS=http://localhost:5173` in `apps/server/.dev.vars`.
- The Electron desktop client never needs an entry here — it is trusted via
  `ELECTRON_PROTOCOL`.

**Verify**: `grep -n 'AUTH_TRUSTED_ORIGINS' apps/server/README.md` → at least
one match.

### Step 3: Make the test harness accept a trusted-origins list

In `apps/server/src/testing/app.ts`, add a fourth parameter to `appFor` with a
default preserving today's behaviour, e.g.:

```ts
export const appFor = (
  member: boolean,
  authenticated = true,
  runSync = /* unchanged default */,
  trustedOrigins: ReadonlyArray<string> = ["http://localhost:5173"],
) => {
```

and use it in place of the hardcoded array at the `c.set("trustedOrigins", …)`
line.

Because it is the last parameter with a default, every existing call site keeps
compiling unchanged.

**Verify**: `bunx vp test apps/server` → exit 0, all existing tests still pass.

### Step 4: Add CORS regression tests

Create `apps/server/src/routes/cors.test.ts`, modelled on
`apps/server/src/routes/uploads.test.ts`. Cover:

1. **An untrusted origin gets no ACAO header.** Build
   `appFor(true, true, undefined, [])` and issue a request to `/api/health`
   with header `Origin: https://evil.example`. Assert the response has no
   `Access-Control-Allow-Origin` header (or that it is empty) — specifically
   assert it is **not** `https://evil.example`.
2. **A configured origin is reflected.** Build
   `appFor(true, true, undefined, ["https://app.example"])`, send
   `Origin: https://app.example`, and assert `Access-Control-Allow-Origin`
   equals `https://app.example` and `Access-Control-Allow-Credentials` is
   `true`.
3. **An empty list trusts no browser origin.** With `appFor(true, true,
undefined, [])` and `Origin: http://localhost:5173`, assert the localhost
   origin is **not** reflected. This is the regression test for exactly the
   bug this plan fixes.

Also send an `OPTIONS` preflight in at least one case to confirm the
untrusted origin is rejected on the preflight path too.

**Verify**: `bunx vp test apps/server` → exit 0, with the new
`cors.test.ts` file reported and all its cases passing.

### Step 5: Confirm the Worker config still builds

**Verify**: from `apps/server`,
`bunx wrangler deploy --dry-run --outdir dist` → exit 0 (this is the existing
`build` script; it validates `wrangler.jsonc` without deploying).

### Step 6: Full verification

**Verify**: `bunx vp check` → exit 0; `bunx vp test` → exit 0;
`bun run check` → exit 0.

## Test plan

New file `apps/server/src/routes/cors.test.ts` with the three cases above plus
one preflight case. Structural pattern: `apps/server/src/routes/uploads.test.ts`.

The load-bearing test is case 3: it fails on `main` today (localhost would be
reflected, because the harness hardcodes it into the list) and passes after the
config and harness changes. Make sure you can articulate why each case would
have caught the original bug.

Verification: `bunx vp test apps/server` → all pass, including 4 new tests.

## Done criteria

ALL must hold:

- [ ] `grep -n 'localhost' apps/server/wrangler.jsonc` → no matches
- [ ] `apps/server/src/routes/cors.test.ts` exists and passes
- [ ] `grep -n 'AUTH_TRUSTED_ORIGINS' apps/server/README.md` → matches
- [ ] `bunx vp check` exits 0
- [ ] `bunx vp test` exits 0
- [ ] `bun run check` exits 0
- [ ] `cd apps/server && bunx wrangler deploy --dry-run --outdir dist` exits 0
- [ ] No secret values appear in any changed file
- [ ] `git status --short` lists only the four in-scope files
- [ ] `plans/README.md` status row for 016 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `commaSeparated("")` does not yield `[]` (check `worker.ts:8-12`) — an empty
  string would then reach `betterAuth` as a bogus origin and the approach must
  change to omitting the variable entirely.
- Setting `AUTH_TRUSTED_ORIGINS` to `""` makes any **existing** test fail. That
  would mean something depends on localhost being trusted by default, which
  contradicts this plan's premise.
- `wrangler` rejects an empty-string `var`, or `--dry-run` fails after the
  config edit.
- You discover an `env.*` block already exists in `wrangler.jsonc` (added
  after this plan was written) — the layering then needs rethinking rather
  than a top-level edit.
- The CORS callback signature in `http/app.ts` differs from the excerpt above.

## Maintenance notes

- **Operational follow-up for the maintainer, not the executor**: if a real
  browser front-end is ever deployed, add its origin to
  `AUTH_TRUSTED_ORIGINS` for that environment only — never back into the
  shared top-level `vars`.
- Anyone doing browser-based local development against the Worker after this
  change must create `apps/server/.dev.vars`; without it, a browser client on
  `localhost:5173` will now be correctly rejected. That is the intended
  behaviour, but it will look like a regression to someone who has not read
  the README. This is a good reason to land the `.env.example` /
  `.dev.vars.example` work that is tracked separately in the backlog.
- A reviewer should confirm the new tests assert on the **absence** of the
  reflected origin, not merely on a 200 status — CORS failures do not change
  the status code, so a status-only assertion would pass either way.
- `packages/auth/src/auth.ts` always trusts `config.baseURL` and the Electron
  protocol origin. If that composition ever changes, these tests will not
  notice; the CORS tests only cover the `trustedOrigins` list.
