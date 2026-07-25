# Plan 009: Decode server/AI-gateway responses at the IPC boundary with Effect Schema

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fe1891d6..HEAD -- apps/desktop/electron/main.ts apps/desktop/src/components/uploads/upload-context.tsx packages/contracts/src`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (small merge overlap with plan 007 in `upload-context.tsx` — see Maintenance)
- **Category**: bug / tech-debt
- **Planned at**: commit `fe1891d6`, 2026-07-19

## Why this matters

The invoice-upload feature calls two server endpoints (`/api/models`,
`/api/uploads`) through the Electron main process and consumes the responses
with bare `as` casts in the renderer. Nothing validates the external
boundary: if the server or AI gateway returns an error body or an unexpected
shape, `payload.lines` is `undefined` and `.map` throws a raw `TypeError`
shown to the user; malformed numeric fields would flow unchecked into
inventory writes. The repo's Effect conventions require decoding untrusted
boundary payloads with `Schema.decodeUnknownEffect` — every other IPC input
in `main.ts` already does this; these two response paths are the gap. Bonus
context: the server endpoints do not exist yet (see plan `plans/README.md`
backlog, DIR-01) — putting the response schemas in `@store/contracts` now
gives the future server implementation its contract for free.

## Current state

- `apps/desktop/electron/main.ts:283-315` — `registerServerIpc` (excerpt):

```ts
ipcMain.handle("server:models", () => authBroker.apiRequest("/api/models"));
ipcMain.handle("server:uploads", async (_event, input: unknown) => {
  // ...hand-rolled runtime checks on input (typeof file.name !== "string" etc.),
  // builds FormData...
  return authBroker.apiRequest("/api/uploads", { method: "POST", body });
});
```

Both return the parsed response verbatim (untyped `unknown` in spirit,
`any`-ish in practice) straight to the renderer.

- `apps/desktop/src/components/uploads/upload-context.tsx`:
  - `:16-26` — local `type Extraction = { lines: Array<{ name; batchNumber; expiresAt; unitsPerPack; packQuantity; unitQuantity; packPrice; ... }> }` and `type GatewayModel = { id: string; name?: string; type?: string }` (read the file for exact fields).
  - `:139` — `const payload = (await window.serverApi.getModels()) as { data?: GatewayModel[] };`
  - `:146-150` — `void loadModels().then(...).catch(() => undefined);` — a
    models-load failure is swallowed silently (the UI keeps `fallbackModels`
    from `:59` with no signal).
  - `:190-207` — `(await window.serverApi.analyseInvoices({...})) as Extraction;`
    then `payload.lines.map(...)` unguarded.
- `apps/desktop/electron/preload.ts:25-31` — `serverApi` bridge:
  `getModels()` / `analyseInvoices(input)` → `ipcRenderer.invoke("server:models" | "server:uploads", ...)`, both returning untyped promises.
- Exemplar for the target pattern — `main.ts:96-101`:

```ts
ipcMain.handle("store:products:search", (_event, input: unknown) =>
  runStore(
    Schema.decodeUnknownEffect(SearchProductsInput)(input).pipe(
      Effect.flatMap(program.searchProducts),
    ),
  ),
);
```

- Contracts pattern to follow: `packages/contracts/src/store.schema.ts` —
  `Schema.Struct` plus a same-name `interface`. Schemas shared between
  renderer, main, and (future) server belong in `@store/contracts`.
- `authBroker.apiRequest` lives in `apps/desktop/electron/auth.ts` — read its
  return type before starting (it likely returns parsed JSON as
  `Promise<unknown>` or similar; do not change it).

## Commands you will need

| Purpose   | Command      | Expected on success                                    |
| --------- | ------------ | ------------------------------------------------------ |
| Install   | `vp install` | exit 0                                                 |
| Check all | `vp check`   | no NEW failures (pre-existing untracked-md failure OK) |
| Tests     | `vp test`    | all pass                                               |

## Scope

**In scope** (the only files you should modify):

- `packages/contracts/src/server-api.schema.ts` (create — `GatewayModel`,
  `ModelCatalogResponse`, `InvoiceExtraction` schemas)
- `packages/contracts/src/index.ts` (export the new module, matching how the
  other schema modules are exported)
- `apps/desktop/electron/main.ts` (`registerServerIpc` only — decode
  responses before returning)
- `apps/desktop/electron/preload.ts` (`serverApi` typings only)
- `apps/desktop/src/components/uploads/upload-context.tsx` (drop the `as`
  casts; import types from `@store/contracts`; surface model-load failure)

**Out of scope** (do NOT touch):

- `apps/desktop/electron/auth.ts` (`apiRequest` implementation).
- `apps/api/**` — the endpoints don't exist there yet; implementing them is
  a separate direction plan (DIR-01 in the backlog).
- `packages/services/**` — its zod schema is a known backlog item; do not
  port it here.
- The `applyChanges` half of `upload-context.tsx` (plan 007 owns it).

## Git workflow

- Branch: `advisor/009-decode-server-responses`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Define the response schemas in contracts

Create `packages/contracts/src/server-api.schema.ts` following the
`Schema.Struct` + same-name-interface pattern of `store.schema.ts`. Derive the
field lists from the existing renderer types (`upload-context.tsx:16-26`) —
they are the de-facto contract:

- `GatewayModel`: `{ id: Schema.String, name: Schema.optional(Schema.String), type: Schema.optional(Schema.String) }`
- `ModelCatalogResponse`: `{ data: Schema.optionalWith(Schema.Array(GatewayModel), { default: () => [] }) }` (or `Schema.optional` + explicit handling — match how optional-with-default is done elsewhere in contracts, if anywhere; otherwise keep it simple and handle `undefined` at the call site).
- `InvoiceExtractionLine` / `InvoiceExtraction` mirroring the renderer's
  `Extraction` type exactly (numbers for quantities/prices,
  `Schema.NullOr` where the renderer type allows null).

Export from `index.ts`.

**Verify**: `vp check` → no new errors in `packages/contracts`.

### Step 2: Decode in `registerServerIpc`

In `main.ts`, wrap both handlers so the response is decoded before it
reaches the renderer, using the same error-shaping the store handlers get
from `runStore` — read `runStore` (`main.ts:81-90`) first; if it is coupled
to `OfflineStore`, add a minimal local equivalent for server calls, e.g.:

```ts
ipcMain.handle("server:models", async () => {
  const raw = await authBroker.apiRequest("/api/models");
  return await Effect.runPromise(
    Schema.decodeUnknownEffect(ModelCatalogResponse)(raw).pipe(
      Effect.mapError(
        () => new Error("The model catalog response was not in the expected format."),
      ),
    ),
  );
});
```

Same for `server:uploads` with `InvoiceExtraction`. Preserve the existing
input validation and FormData assembly untouched. Keep error messages
user-presentable (the renderer toasts `error.message`).

**Verify**: `vp check` → no new errors.

### Step 3: Consume typed responses in the renderer

In `upload-context.tsx`:

- Delete the local `Extraction`/`GatewayModel` type declarations; import the
  types from `@store/contracts`.
- Remove both `as` casts (`:139`, `:199`); the values are now typed by the
  preload signature — update `preload.ts`'s `serverApi` to declare
  `Promise<ModelCatalogResponse>` / `Promise<InvoiceExtraction>` (type-only
  imports from `@store/contracts`, matching how `preload.ts` already imports
  `OfflineStoreApi`).
- Replace `.catch(() => undefined)` (`:150`) with a visible signal: on
  failure keep `fallbackModels` but `toast.warning`/`toast.error` once (match
  the toast style used elsewhere in the file, e.g. `:159`) so the user knows
  live models were unavailable.

**Verify**: `vp check` → no new errors;
`grep -n "as Extraction\|as { data" apps/desktop/src/components/uploads/upload-context.tsx` → no matches.

### Step 4: Full suite

**Verify**: `vp test` → all pass.

## Test plan

The decode logic itself is exercised through schema round-trips: add a small
test file `packages/contracts/src/server-api.schema.test.ts` (pattern:
any existing contracts test; if none exists, model on
`packages/persistence/src/errors.test.ts` — plain vitest + `Schema.decodeUnknownEffect` + `Effect.runSync`/`runSyncExit`):

1. A valid extraction payload decodes to the expected struct.
2. A payload missing `lines` fails decoding (assert the Exit/either is a
   failure — do not assert exact message text).
3. A model catalog with `data` absent decodes to an empty/absent list rather
   than throwing.

**Verification**: `vp test` → all pass including the 3 new tests. (If adding
a test to `packages/contracts` requires a `test` script/vitest dep the
package lacks, put the same tests in
`packages/persistence/src/server-api-contract.test.ts` instead — persistence
already depends on contracts and has the vitest wiring.)

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `vp check` — no new failures
- [ ] `vp test` exits 0 with 3 new schema tests passing
- [ ] `grep -rn "as Extraction\|as { data?: GatewayModel" apps/desktop/src` → no matches
- [ ] `grep -n "catch(() => undefined)" apps/desktop/src/components/uploads/upload-context.tsx` → no matches
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `authBroker.apiRequest` turns out to return a `Response` object rather
  than parsed JSON — decoding then needs a different insertion point; report
  rather than restructuring `auth.ts`.
- Effect cannot be used in `main.ts`'s server handlers without pulling a
  runtime you'd have to construct ad hoc — `main.ts` already imports
  `Effect`/`Schema` and runs store effects, so this should not happen; if it
  does, report.
- The renderer type and your schema disagree on a field's optionality and
  you cannot tell which is right — the server doesn't exist yet to check
  against; report the ambiguity instead of guessing loosely.

## Maintenance notes

- Plan 007 rewrites `applyChanges` in the same file (different function);
  coordinate merges if both are in flight.
- When the server endpoints are actually implemented (backlog DIR-01), they
  MUST encode responses satisfying these contracts — point the implementer at
  `packages/contracts/src/server-api.schema.ts`.
- Reviewers should reject future `as`-cast consumption of `ipcRenderer.invoke`
  results; the preload signature + contracts schema is the pattern.
