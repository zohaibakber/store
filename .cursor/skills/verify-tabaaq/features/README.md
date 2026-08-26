# Tabaaq verification map

This directory is the maintained source for verifying user-facing behavior of the Tabaaq web SPA. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `.cursor/skills/verify-tabaaq/scripts/launch.sh` so the instance is owned by this run.
- Base URL is `http://127.0.0.1:5174`.
- Run `.cursor/skills/verify-tabaaq/scripts/doctor.sh` and require `spa ok title=Tabaaq` with a pid this run started.
- Never drive an instance that was not started by this verification run.
- Authenticated features also require `doctor: api ok` and a real sign-in (email/password, OTP when `AUTH_DEV_OTP` is on, or Google). Browser hosts have no guest workspace.

## Driving conventions

- Start every recipe from the baseline unless its preconditions say otherwise.
- Prefer ARIA roles and accessible names over CSS selectors or DOM position.
- Treat every command as literal. Keep quoted names and routes unchanged.
- Drive the SPA with Cursor browser tools against `http://127.0.0.1:5174`.
- Restore mutated catalog rows after a mutation when the feature file names the fixture. Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot with the Tabaaq heading or brand visible.
- Mutation proof includes a second user-facing read of the stored value.
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition (especially `api down` or redirect to `/sign-in`).
- Do not report a skipped entry point as verified through a different path.
- Do not treat desktop “Continue offline” as proof of the browser product.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with Cursor browser` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Sign in](./sign-in.md) covers the unauthenticated shell: email continue, Google, password, OTP, and the browser-only absence of guest access.
- [Home dashboard](./home.md) covers the signed-in home route and its inventory tiles.
- [Products catalog](./products.md) covers the product list, add, import, and create form.
- [Invoices](./invoices.md) covers the invoice list and new sale.
- [Settings](./settings.md) covers account, organization, categories, appearance, and about.
