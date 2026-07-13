# Store invoice API

A Hono app, deployed to Vercel as a Vercel Function, that accepts invoice attachments and returns
structured inventory lines.

```sh
bunx vercel --prod
```

Set `AI_GATEWAY_API_KEY` in the Vercel project. The service uses AI SDK through Vercel AI Gateway,
so the selected model can come from any supported provider. Run `bun run vercel:dev` for local
development — it serves `src/index.ts` directly with Vercel's local emulation and automatically
refreshed Gateway development credentials.

Set `STORE_API_URL` (preferred) or `VITE_API_URL` in the desktop app to the deployed API origin.
Values ending in `/api` are also accepted. During local development, `http://localhost:8787` is
used by default.

## Authentication and organizations

Better Auth lives in the shared `@store/auth` package (`packages/auth`) — email/password,
organization, signed bearer, and Electron plugins, backed by Postgres (Neon's serverless HTTP
driver). This API mounts it in-process at `/api/auth/*` (`app.on(["GET","POST"], "/api/auth/*", ...)`
in `src/index.ts`) and calls `auth.api.getSession`/`auth.api.getActiveMember` directly — no network
hop. Sign-in and sign-up responses expose the session token in the `set-auth-token` header.
Electron must keep that token in main-process secure storage and send it as
`Authorization: Bearer <token>`; never expose it to the renderer. `GET /api/models`,
`POST /api/uploads`, and both `GET` and `POST /api/sync/credentials` require a valid session, an
active organization, and current membership in that organization.

Production requires these server-only variables:

- `BETTER_AUTH_SECRET`: high-entropy secret of at least 32 bytes.
- `BETTER_AUTH_URL`: public API origin, such as `https://api.example.com`.
- `DATABASE_URL`: Neon Postgres connection string for the auth database.
- `AUTH_TRUSTED_ORIGINS`: comma-separated exact browser origins. Never use `*`.
- `ELECTRON_PROTOCOL`: reverse-domain application protocol; defaults locally to `com.tabaaq.desktop`.
- `TURSO_PLATFORM_API_TOKEN`: server-only Platform API token used to mint scoped credentials.
- `TURSO_ORGANIZATION_SLUG`: Turso organization that owns tenant databases.
- `TURSO_DATABASE_NAME_TEMPLATE`: defaults to `store-{organizationId}`.
- `TURSO_DATABASE_GROUP`: group used when provisioning organization databases; defaults to
  `default`.
- `TURSO_DATABASE_URL_TEMPLATE`: for example
  `libsql://{databaseName}-{tursoOrganization}.turso.io`.

The sync endpoint idempotently provisions the organization's database when it is first used, then
mints a full-access token restricted to exactly that database and expiring after 15 minutes. It
never returns the Platform API token or a group-wide database token. This is unrelated to
authentication — it's Turso's own tenant database provisioning, kept in this API. `DATABASE_URL`
above is a separate, dedicated Postgres database from the per-organization Turso sync databases.

Run `bun run auth:generate` in `packages/auth` after changing Better Auth plugins/schema, then
`bun run db:generate` to write a Drizzle migration and `bun run db:migrate` to apply it. Both
drizzle-kit commands read `DATABASE_URL` from `apps/api/.env.local`.

`POST /uploads` accepts at most five multipart `files` (PDF or CSV), limits each file to 10 MB and
the request to 25 MB, and returns the extraction
review. The desktop applies approved changes locally and uses its existing Turso sync service to
push and pull database state.
