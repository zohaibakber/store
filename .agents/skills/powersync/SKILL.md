---
name: powersync
description: Configure or debug PowerSync streams, client replication, authentication, and uploads.
license: MIT
compatibility: Works with any skills-compatible agent. Some references include CLI commands requiring the @powersync/cli package.
metadata:
  author: powersync
  version: "1.2.0"
  organization: PowerSync
  tags: powersync, offline-first, local-first, sync-streams, sqlite, replication, uploadData, fetchCredentials, service-config, sync-config, cloud, cli, debugging, supabase, postgres, mongodb, mysql, electric, electric-migration
---

# PowerSync

Use the existing backend, deployment tooling, and pinned SDKs. This project uses Postgres for inventory authority and PowerSync for organization-scoped client replicas; a local SDK fix does not require new infrastructure.

## Scope and completion

Infer the environment and backend from project configuration and the conversation. Ask only for missing information needed by the current operation. Prepare and validate local changes within the requested scope; deployment requires authorization for the target and operation. Reuse authorization already given and verify the actual target before applying it.

For new onboarding, choose the matching guide below. Service readiness is needed for end-to-end sync verification, but independent client implementation can proceed while credentials or setup are pending. Prefer existing IaC for managed resources; CLI workflows are available for CLI-managed instances.

Keep secrets in the project's untracked environment or secret store. Do not hardcode them or upgrade dependencies as an incidental part of a fix. `pull instance` overwrites local configuration, so preserve local edits before using it.

## SDK invariants

- PowerSync creates the `id` column automatically. Represent booleans with integer columns and ISO dates with text columns.
- Connection initiation is separate from first-sync readiness. Keep `waitForFirstSync()` off the shell's first-paint path.
- Complete an upload transaction only after it succeeds or is deliberately handled under the application's rejection policy. An uncompleted transaction retries; completing a failed write loses that queued work.
- Clear the replica when logout or an identity/organization switch requires removing the previous identity's data. Coordinate this with pending-write policy.
- New sync configurations use Sync Streams. Do not migrate existing Sync Rules as an unrelated change.

## What to Load for Your Task

| Task | Start with | Load on demand |
|------|-----------|----------------|
| Supabase + PowerSync | `references/onboarding-supabase.md` | `references/supabase-auth.md`, `references/sync-config.md`, SDK files |
| Custom backend (non-Supabase) | `references/onboarding-custom.md` | `references/custom-backend.md`, `references/sync-config.md`, SDK files |
| New project setup | `references/powersync-cli.md` + `references/powersync-service.md` | `references/sync-config.md`, SDK files |
| Migrating from Electric Cloud | `references/migration-from-electric.md` | `references/sync-config.md`, SDK files |
| Self-hosting / service config | `references/powersync-service.md` + `references/powersync-cli.md` | `references/sync-config.md` |
| Terraform / IaC provisioning | `references/terraform.md` | `references/sync-config.md`, `references/supabase-auth.md` (if Supabase source) |
| Writing sync config | `references/sync-config.md` | — |
| Debugging sync issues | `references/powersync-debug.md` | — |
| Raw Tables (advanced) | `references/raw-tables.md` | — |
| Attachments | `references/attachments.md` | — |
| Architecture overview | `references/powersync-overview.md` | — |
| SQLite extensions (vector search, FTS5, custom tokenizers) | `references/sqlite-extensions.md` | — |

## SDK Reference Files

### JavaScript / TypeScript

For SDK lifecycle and upload changes, use `references/sdks/powersync-js.md`; add the framework reference when its integration is relevant.

| Framework | File | Load early if… |
|-----------|------|----------------|
| React / Next.js | `references/sdks/powersync-js-react.md` | Vite + React project — contains the required `vite.config.ts` setup (`optimizeDeps.exclude`, `worker.format: 'es'`) needed before installing packages |
| React Native / Expo | `references/sdks/powersync-js-react-native.md` | |
| Vue / Nuxt | `references/sdks/powersync-js-vue.md` | |
| Node.js / Electron | `references/sdks/powersync-js-node.md` | |
| TanStack | `references/sdks/powersync-js-tanstack.md` | |
| Drizzle / Kysely ORM | `references/sdks/powersync-js-orm.md` | Project uses Drizzle or Kysely |

### Other SDKs

| Platform | File |
|----------|
| Dart / Flutter | `references/sdks/powersync-dart.md` |
| .NET | `references/sdks/powersync-dotnet.md` |
| Kotlin | `references/sdks/powersync-kotlin.md` |
| Swift | `references/sdks/powersync-swift.md` |
