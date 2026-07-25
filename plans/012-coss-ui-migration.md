# Plan 012: Migrate the desktop UI from shadcn/ui to coss ui

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Skills (mandatory)**: Before writing or editing ANY component code,
> invoke the `coss` skill and read its migration rules
> (`.claude/skills/coss/references/rules/migration.md`), plus the primitive
> reference for each component you touch
> (`.claude/skills/coss/references/primitives/<name>.md`). Use the
> `coss-particles` skill to find composition examples. Do not write coss
> code from memory of shadcn patterns.
>
> **Drift check (run first)**:
> `git diff --stat 39de419d..HEAD -- apps/desktop/src/components apps/desktop/src/routes apps/desktop/src/styles.css apps/desktop/components.json`
> If in-scope files changed since this plan was written, compare the
> "Current state" section against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MEDIUM (large surface, no behavior change intended)
- **Depends on**: none
- **Category**: refactor (UI library migration)
- **Planned at**: commit `39de419d`, 2026-07-24

## Why this matters

The user wants to switch the desktop app's UI to [coss ui](https://coss.com/ui/docs)
for its visual quality. coss is a Base UI + Tailwind v4 copy-paste registry
with shadcn-like ergonomics, installed through the shadcn CLI under the
`@coss` namespace. This migration is unusually low-friction here because the
app is **already** on the prerequisites:

- Tailwind CSS v4 (`tailwindcss ^4.3.2`)
- `@base-ui/react ^1.6.0` already a dependency (shadcn style `base-mira` is
  Base UI-flavored)
- Copy-paste components in `apps/desktop/src/components/ui/` owned by us

Note: coss **does** ship a Sidebar primitive
(`.claude/skills/coss/references/primitives/sidebar.md`), so the app shell
migrates too — no custom fallback needed.

## Current state

- `apps/desktop/components.json` — shadcn config: style `base-mira`,
  `iconLibrary: "hugeicons"`, css `src/styles.css`, aliases `@/components/ui`,
  `"registries": {}` (empty — `@coss` resolves via the shadcn public registry
  directory; verify in step 1).
- `apps/desktop/src/styles.css` — imports `tailwindcss`, `tw-animate-css`,
  `shadcn/tailwind.css`, Inter; defines `@theme inline` tokens including
  `--color-sidebar-*` and `--color-chart-1..5`; `@custom-variant dark`.
- `apps/desktop/src/components/ui/` — 60 shadcn component files. Only ~37 are
  imported outside the ui dir (usage counts from `grep` at plan time):
  button 22, card 13, sidebar 8, field 7, badge 7, input 6, alert 6, select 5,
  item 5, spinner 4, number-field 4, empty 4, dropdown-menu 4, input-group 3,
  dialog 3, button-group 3, tooltip 2, separator 2, progress 2, and 1 each of
  table, switch, sonner, popover, label, kbd, command, combobox, collapsible,
  chart, calendar, avatar, attachment, alert-dialog, textarea, toggle,
  skeleton, sheet.
- App shell: `components/app-sidebar.tsx` (Sidebar, SidebarHeader/Content/
  Footer + NavMain/NavUser/TeamSwitcher/SyncButton/SearchForm),
  `components/site-header.tsx`, `components/window-controls.tsx`,
  `routes/__root.tsx` (SidebarProvider + Toaster from sonner).
- Toasts: `components/ui/sonner.tsx` (Sonner); `toast(...)` call sites in
  ~10 files (product-form, settings-page, product-visibility, team-switcher,
  nav-user, product-batches, invoices/invoice-create-context,
  routes/__root.tsx, routes/products/$productId.tsx, uploads/upload-context).
- Charts: `components/ui/chart.tsx` is the shadcn recharts wrapper
  (`recharts` is a dependency). coss has **no chart primitive** — this file
  stays.
- Icons: hugeicons throughout app code.
- Package manager: **bun** — use `bunx --bun shadcn@latest ...`.

## Constraints / decisions

- **In-place migration**: overwrite files in `src/components/ui/` with coss
  versions; fix call sites. No parallel directory, no gradual dual-library
  state at the end.
- **Keep**: `chart.tsx` (recharts wrapper), `data-table.tsx` (TanStack Table
  v9 beta — restyle only if the coss `table` primitive changes markup),
  `date-picker.tsx`, `attachment.tsx`, `message*/bubble/marker` only if used.
- **Icons**: leave whatever icons the installed coss files import (add
  `lucide-react` as a dep if coss files need it). App-level code keeps
  hugeicons. Do not rewrite icon imports inside `ui/` files — minimal diff
  from upstream keeps future re-installs cheap.
- **Toast**: migrate Sonner → coss toast (`toastManager`) as its own phase
  (step 6). This is the API-heaviest change; do it after everything else
  compiles.
- **Components with no direct coss equivalent** (`item`, `button-group`):
  check `references/component-registry.md` first (`group` may cover
  button-group). If no equivalent exists, keep the current file and restyle
  minimally so it doesn't visually clash.

## Steps

1. **Verify registry access.**
   `bunx --bun shadcn@latest add @coss/button --dry-run` from `apps/desktop/`.
   - If the `@coss` namespace fails to resolve, add to `components.json`:
     `"registries": { "@coss": "https://coss.com/ui/r/{name}.json" }`
     (verify exact URL pattern via `.claude/skills/coss/references/cli.md`
     and https://coss.com/ui/llms.txt) and retry.
   - Expected: dry run lists files targeting `src/components/ui/`.

2. **Install the coss theme.**
   `bunx --bun shadcn@latest add @coss/style` (accept overwrites into a dirty
   git tree ONLY after committing current work — run on a clean branch
   `coss-ui-migration`). Then reconcile `src/styles.css` by hand:
   - Keep: Inter font imports/vars, `@custom-variant dark`, all
     `--color-sidebar-*` and `--color-chart-*` token wiring, any custom vars
     used by window-controls/titlebar.
   - Replace: `@import "shadcn/tailwind.css"` with whatever base css the coss
     style provides. Drop `tw-animate-css` only if nothing in the final tree
     references its classes (grep `animate-` usages against what coss css
     provides).
   - Verify: `vp dev` renders with the new theme; light and dark both usable.

3. **Install used primitives.** From the usage list in "Current state",
   install every component that exists in the coss registry
   (`.claude/skills/coss/references/component-registry.md` is the index):
   button, card, sidebar, field, badge, input, alert, select, spinner,
   number-field, empty, menu (replaces dropdown-menu), input-group, dialog,
   tooltip, separator, progress, table, switch, popover, label, kbd, command,
   combobox, collapsible, calendar, avatar, alert-dialog, textarea, toggle,
   skeleton, sheet, toast, group (if adopting for button-group), tabs.
   One `add` command with multiple components is fine. Let the CLI overwrite
   the existing files.

4. **Fix call sites** (the bulk of the work). Apply
   `references/rules/migration.md` mechanically across
   `src/components/` (excluding `ui/`) and `src/routes/`:
   - `asChild` → `render={<... />}` (only where the coss part supports
     `render`).
   - `DropdownMenu*` → `Menu*` names; `onSelect` → `onClick` on menu items.
   - `SelectContent`/`SelectItem` children pattern → items-first pattern with
     `SelectPopup` (see `references/primitives/select.md`); 5 call sites.
   - Dialog/AlertDialog/Popover/Tooltip: verify trigger/popup part names
     against each primitive doc (`DialogPopup` etc.).
   - Field/form composition per `references/rules/forms.md` (product-form is
     the big one — it uses TanStack Form + field.tsx; keep TanStack Form,
     adapt Field parts only).
   - After each component family, run `vp check` in `apps/desktop` until
     clean.

5. **Migrate the app shell.** Read
   `references/primitives/sidebar.md` fully first. Adapt
   `app-sidebar.tsx`, `nav-main.tsx`, `nav-user.tsx`, `nav-secondary.tsx`,
   `nav-projects.tsx`, `team-switcher.tsx`, `search-form.tsx`,
   `site-header.tsx`, and the `SidebarProvider`/trigger wiring in
   `routes/__root.tsx` to the coss sidebar API. Preserve: collapse behavior,
   the command-menu trigger in the search form, window-controls placement
   (Electron titlebar — do not let sidebar layout overlap the drag region).

6. **Migrate toasts.** Read `references/primitives/toast.md`. Replace
   `components/ui/sonner.tsx` + the `<Toaster />` mount in `__root.tsx` with
   the coss toast provider, and convert every `toast.*()` call site (~10
   files, listed in "Current state") to `toastManager`. Preserve message
   semantics (success/error/description). Remove the `sonner` dependency.

7. **Delete dead ui files.** For every file in `src/components/ui/` with zero
   imports outside the ui dir (verify each with grep at execution time —
   candidates: carousel, menubar, navigation-menu, aspect-ratio, hover-card,
   context-menu, drawer, resizable, scroll-area, breadcrumb, pagination,
   radio-group, slider, toggle-group, accordion, direction, native-select,
   message, message-scroller, bubble, marker), delete it. Do not delete a
   file another ui file imports.

8. **Dependency cleanup.** After `vp check` is clean:
   - `grep -rn "radix-ui" apps/desktop/src` — if zero hits, remove the
     `radix-ui` dependency.
   - Remove `sonner`; remove `input-otp`/`react-day-picker` etc. only if now
     unused. Keep `recharts`.
   - `bun install` to settle the lockfile.

9. **Verification.**
   - `vp check` — clean.
   - `vp test` — same pass count as baseline (28 tests at plan time; UI-only
     change should not affect them).
   - `vp dev` (or the project's run skill): click through Home, Products
     (list, detail, create/edit form, batches, visibility toggle, delete
     dialog), Invoices (list, create flow), Settings, command menu (Cmd+K),
     team switcher, sync button, theme toggle, at least one toast success and
     one toast error. Both light and dark mode.

## STOP conditions

- The `@coss` registry is unreachable or a needed primitive doesn't exist in
  the registry and has no documented equivalent.
- The coss sidebar cannot reproduce the current shell layout (Electron
  titlebar/drag-region conflict) after a genuine attempt.
- `vp test` regressions that are not obviously import-path fallout.
- The coss style's token names diverge so far from the current shadcn tokens
  that `chart.tsx`/`data-table.tsx` would need a rewrite — report instead.

## Out of scope

- Any behavior/feature change (that's plan 013 for the homepage).
- Restyling `chart.tsx` internals beyond token compatibility.
- The server app and packages/* — renderer-only.
