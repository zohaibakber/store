# Settings

Settings is the signed-in account and store configuration. `/settings` redirects to Account. Further tabs cover organization, categories, appearance, and about.

## Sub-features

- `settings-account` opens `/settings/account` with title `Account`.
- `settings-organization` opens `/settings/organization`.
- `settings-categories` opens `/settings/categories` with title `Categories`.
- `settings-appearance` opens `/settings/appearance`.
- `settings-about` opens `/settings/about` with title `About Tabaaq`.

## How to get to it (user POV)

- Choose `Settings` in the sidebar footer.
- Open `/settings` (redirects to Account).
- Choose the Settings nav labels `Account`, `Organization`, `Categories`, `Appearance`, `About`.

## Driving it with Cursor browser

Preconditions:

- Doctor reports `spa ok` and `api ok`.
- A signed-in organization session exists for organization and category mutations. Account and About still require admit (browser redirects guests to sign-in).

- **Open settings.** Choose `Settings` or go to `http://127.0.0.1:5174/settings`. Location becomes `/settings/account`. Title `Account` is visible. Signed-in proof shows the user’s name and email and a `Log out` control. `Not signed in` means the session was not admitted.
- **Organization.** Choose `Organization`. Title `Organization` (or the store profile card) is visible. Copy `Sign in on the Account tab` means the session is missing.
- **Categories.** Choose `Categories`. Title `Categories` is visible.
- **Appearance.** Choose `Appearance`.
- **About.** Choose `About`. Title `About Tabaaq` is visible.
- **Proof.** Save `artifacts/settings/account.png` with the signed-in name/email visible, plus snapshots for any other tab you claim.

## Gotchas

- `/settings` never stays at `/settings`; the index redirects to Account.
- `Log out` returns the browser product to `/sign-in`. Do not log out until other authenticated features in the same run are finished.
- Feedback in the sidebar is a no-op (`href="#"`). Do not treat it as a feature.
