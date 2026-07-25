# Plan 006: Decompose the invoice-upload page into a provider + composed components

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a98b4aa7..HEAD -- apps/desktop/src/routes/products/upload.tsx`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW-MED
- **Depends on**: none
- **Category**: tech-debt (composition) — also fixes a small reactivity bug
- **Planned at**: commit `a98b4aa7`, 2026-07-15

## Why this matters

`apps/desktop/src/routes/products/upload.tsx` is a 464-line god component —
the largest non-vendored file in the renderer. It mixes the route loader, a
models-fetching effect, six pieces of state, two multi-step async mutation
flows (`analyse`, `applyChanges`), and all the JSX (model combobox, dropzone,
attachment list, progress, review list, empty state). The rest of the app
already converged on a better pattern — the invoice-create flow is a context
provider exposing `{state, actions, meta}` with small composed children. This
plan applies that same pattern here, and fixes a real bug along the way:
`navigator.onLine` is read during render with no event subscription, so the
offline banner can be stale.

## Current state

- `apps/desktop/src/routes/products/upload.tsx` — everything described above.
  Key structure today (line refs at `a98b4aa7`):
  - `:57-72` local types `ExtractedLine`, `Extraction`, `ProposedChange`, `GatewayModel`, `ModelGroup`
  - `:74-83` route definition + loader (`listProducts` + `listCategories`)
  - `:85-133` module-level constants/helpers (`defaultModel`, `fallbackModels`, `providerLabels`, `groupModelsByProvider`, `fileDescription`, `isInvoice`, `sameProduct`, `validTimestamp`)
  - `:135-167` component state + models-fetching `useEffect` (with `cancelled` flag)
  - `:169-181` `addFiles` (filters non-PDF/CSV, dedupes by name+size)
  - `:183-219` `analyse` — gated on `navigator.onLine`, posts files to `window.serverApi.analyseInvoices`, maps lines to `ProposedChange[]` (matching existing products by lowercased name)
  - `:221-270` `applyChanges` — gated on `navigator.onLine`, creates products/batches via `window.offlineStore`, runs `sync()`, `router.invalidate()`, resets
  - `:272-464` the full JSX; `:289` renders the offline alert from a bare `navigator.onLine` read
- **The exemplar to mirror** — the invoice-create flow:
  - `apps/desktop/src/components/invoices/invoice-create-context.tsx` — a
    provider component owning state + async submit, exposing
    `{ state, actions, meta }` through `createContext` + a `useInvoiceCreate()`
    hook that calls `use(Context)` and throws if used outside the provider.
    Interface shape (excerpt, `invoice-create-context.tsx:19-49`):

```ts
interface InvoiceCreateContextValue {
  state: InvoiceCreateState; // raw state values
  actions: InvoiceCreateActions; // event handlers / async flows
  meta: InvoiceCreateMeta; // derived values (errors, totals, canSubmit)
}
```

- Sibling files `invoice-create-line.tsx`, `invoice-create-checkout.tsx`,
  `invoice-create-items.tsx`, `invoice-product-picker.tsx` are small
  consumers that call the hook. The route (`routes/invoices/new.tsx`) just
  composes provider + children.
- React 19 is in use: new files should use `use(Context)` and `<Context value={…}>` (not `useContext`/`<Context.Provider>`), matching `invoice-create-context.tsx` and `data-table.tsx:125`.
- Repo conventions: files kebab-case; ui primitives from `@/components/ui/*`; typography rules in AGENTS.md (no font weights above 500, no `strokeWidth` on icons).

## Commands you will need

| Purpose   | Command                | Expected on success |
| --------- | ---------------------- | ------------------- |
| Install   | `vp install`           | exit 0              |
| Check all | `vp check` (repo root) | exit 0              |
| Tests     | `vp test` (repo root)  | all pass            |
| Run app   | `vp run dev` (root)    | desktop app boots   |

## Suggested executor toolkit

- If the `vercel-composition-patterns` skill is available, read
  `rules/state-context-interface.md` and `rules/architecture-compound-components.md`
  before Step 2.

## Scope

**In scope**:

- `apps/desktop/src/routes/products/upload.tsx` (shrinks to route + composition)
- `apps/desktop/src/components/uploads/` (create — new directory):
  - `upload-context.tsx`
  - `upload-model-picker.tsx`
  - `upload-dropzone.tsx`
  - `upload-attachment-list.tsx`
  - `upload-proposed-changes.tsx`
- `apps/desktop/src/hooks/use-online.ts` (create)

**Out of scope** (do NOT touch):

- `components/invoices/**` — the exemplar; read-only.
- The behavior of `analyse`/`applyChanges` — port the logic verbatim (same
  toasts, same guards, same reset semantics). This is a structure refactor,
  not a behavior change, except for the one online-status fix below.
- `window.serverApi` / `window.offlineStore` bridges, contracts, main process.

## Git workflow

- Branch: `advisor/006-upload-page-composition-refactor`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Reactive online status hook

Create `apps/desktop/src/hooks/use-online.ts`:

```ts
import { useSyncExternalStore } from "react";

const subscribe = (onStoreChange: () => void) => {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
};

export const useOnline = () => useSyncExternalStore(subscribe, () => navigator.onLine);
```

**Verify**: `vp check` → exit 0.

### Step 2: The provider

Create `apps/desktop/src/components/uploads/upload-context.tsx`, mirroring
`invoice-create-context.tsx`'s structure exactly:

- Move the types (`ExtractedLine`, `Extraction`, `ProposedChange`,
  `GatewayModel`, `ModelGroup`) and the module-level helpers/constants
  (`defaultModel`, `fallbackModels`, `providerLabels`, `providerLabel`,
  `groupModelsByProvider`, `fileDescription`, `isInvoice`, `sameProduct`,
  `validTimestamp`) into this file (export the types the children need).
- `UploadProvider` props: `{ products, categories, children }` (loader data
  comes in from the route).
- Owns: `files`, `state` machine (`"idle" | "processing" | "ready" | "syncing"`),
  `changes`, `model`, `models`, the models-fetching `useEffect`, `addFiles`,
  `removeFile(file)`, `analyse`, `applyChanges` — all ported verbatim from
  `upload.tsx:135-270`, with ONE change: replace both `navigator.onLine`
  guards with an `isOnline` value from `useOnline()` captured in the provider.
- Context value follows the repo interface convention:

```ts
interface UploadContextValue {
  state: { files: File[]; phase: UploadPhase; changes: ProposedChange[]; model: GatewayModel };
  actions: { addFiles; removeFile; setModel; analyse; applyChanges };
  meta: { groupedModels: ModelGroup[]; processing: boolean; isOnline: boolean };
}
```

(Rename the state-machine variable from `state` to `phase` to avoid
`state.state`.)

- Export `useUpload()` — `use(UploadContext)` with a thrown error when null,
  same as `useInvoiceCreate`.

**Verify**: `vp check` → exit 0 (children don't exist yet; the provider must
compile standalone).

### Step 3: The children

Create the four consumer components, each reading `useUpload()` — move the
corresponding JSX verbatim from `upload.tsx`:

| New file                      | JSX moved from `upload.tsx`                                     |
| ----------------------------- | --------------------------------------------------------------- |
| `upload-model-picker.tsx`     | the `Field` + `Combobox` block (`:306-336`)                     |
| `upload-dropzone.tsx`         | hidden `input[type=file]` + drop `button` (`:337-358`)          |
| `upload-attachment-list.tsx`  | `AttachmentGroup` + `Progress` blocks (`:359-397`)              |
| `upload-proposed-changes.tsx` | the "Proposed changes" `Card` incl. apply `Button` (`:400-446`) |

Keep each file's imports minimal (only the ui primitives it renders).

**Verify**: `vp check` → exit 0.

### Step 4: Shrink the route

Rewrite `routes/products/upload.tsx` to: route definition + loader
(unchanged), then a page component that renders `PageLayout`/`PageHeader`
(heading, description, the "Analyse invoices" `PageAction` button driven by
`useUpload` — so the action button becomes a small child component too, or
inline inside the provider subtree), the offline `Alert` driven by
`meta.isOnline`, the attachments `Card` composing `UploadModelPicker` +
`UploadDropzone` + `UploadAttachmentList`, `UploadProposedChanges`, and the
`Empty` state. Everything inside `<UploadProvider products={products} categories={categories}>`.

Note: the "Analyse invoices" button lives in `PageAction` in the header while
the provider must wrap it — wrap the whole `PageLayout` content in the
provider (the provider renders no DOM of its own, so this is safe).

**Verify**:

- `vp check` → exit 0
- `wc -l apps/desktop/src/routes/products/upload.tsx` → under ~120 lines
- `grep -n "navigator.onLine" apps/desktop/src/routes/products/upload.tsx apps/desktop/src/components/uploads/*.tsx` → no matches (only `use-online.ts` touches it)

### Step 5: Manual smoke test

`vp run dev` → Products → Upload Invoices:

1. Drop/browse a CSV → appears in the attachment list; a non-CSV/PDF file is
   rejected with the toast.
2. Model combobox lists grouped models (fallback list if the API is
   unreachable) and selection sticks.
3. With no files, "Analyse invoices" is disabled.
4. Toggle DevTools network to offline → the offline alert appears **without a
   re-render trigger**; back online → it disappears. (This is the bug fix —
   verify it explicitly.)
5. If an API is available: analyse a small CSV → review list renders → apply →
   toast + navigation state resets, products appear after `router.invalidate()`.
   If no API is available, steps 1–4 plus a failed-analyse toast are sufficient;
   note which path you verified.

**Verify**: behaviors above; no console errors.

## Test plan

No component test harness exists in `apps/desktop`; verification is
`vp check` + Step 5. Keep the pure helpers (`groupModelsByProvider`,
`isInvoice`, `validTimestamp`, `sameProduct`) exported from
`upload-context.tsx` so a future vitest DOM-less unit test can cover them —
but do not add a test framework in this plan.

## Done criteria

- [ ] `vp check` exits 0; `vp test` exits 0
- [ ] `routes/products/upload.tsx` ≤ ~120 lines; five new files exist under `components/uploads/` + `hooks/use-online.ts`
- [ ] Context value follows `{ state, actions, meta }`; consumers use `use()` not `useContext()`
- [ ] `navigator.onLine` is read only inside `use-online.ts`
- [ ] Manual smoke test performed, including the offline-banner reactivity check
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Porting `analyse`/`applyChanges` verbatim is impossible because they close
  over something the provider can't own (they shouldn't — their only external
  inputs are `products`, `categories`, `files`, `model`, `changes`, `router`).
- The `Combobox` (Base UI) misbehaves when moved (its function-children API is
  a library render-prop pattern and must move unchanged) — if it breaks,
  compare against the in-tree usage in `invoice-product-picker.tsx`.
- You are tempted to "improve" the import flow's behavior (different toasts,
  extra validation) — behavior changes are out of scope except the
  online-status fix.

## Maintenance notes

- Future work on the import flow (per-line editing of proposed changes,
  category selection) should extend `UploadContextValue.actions`/`meta`, not
  add props to the children — reviewers should hold that line.
- The memory/notes mention a planned "scan + sync pipeline" for the inventory
  app; this provider is where a scan-input source would plug in alongside the
  dropzone.
- The `useOnline` hook is now the canonical connectivity source for the
  renderer; a follow-up could reconcile it with `AuthSnapshot.isOnline`
  (`lib/auth.tsx`) so there is exactly one notion of "online".
