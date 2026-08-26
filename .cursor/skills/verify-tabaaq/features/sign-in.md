# Sign in

Sign in is the only public browser route. An unauthenticated user sees the Tabaaq identifier form; continuing with an email leads to password, one-time code, or registration. Google is a parallel entry. The browser product does not offer a guest catalog.

## Sub-features

- `sign-in-shell` shows the identifier form on `/sign-in`.
- `sign-in-email` submits the email field with Continue.
- `sign-in-google` starts Continue with Google.
- `sign-in-password` submits a password on the password step.
- `sign-in-otp` submits a one-time code when the identify route is OTP.
- `sign-in-no-guest` refuses app routes without a session (redirect back to `/sign-in`).

## How to get to it (user POV)

- Open the app while signed out (any deep link redirects here).
- Open `/sign-in` directly.
- Choose Sign in from Account settings when the host shows that control.

## Driving it with Cursor browser

Preconditions:

- Doctor reports `spa ok title=Tabaaq` for the instance this run launched.
- Start with no authenticated session on this origin (or use a fresh browser profile).
- `sign-in-email` and later steps need `doctor: api ok`. Skip those steps when the API is down; still run `sign-in-shell` and `sign-in-no-guest`.

- **Open shell.** Navigate to `http://127.0.0.1:5174/sign-in`. The heading is `Sign in to Tabaaq`. A textbox named `Email` and buttons `Continue` and `Continue with Google` are visible.
- **Reject guest catalog.** Navigate to `http://127.0.0.1:5174/` and to `http://127.0.0.1:5174/products`. The location returns to `/sign-in` and the same identifier heading is shown.
- **Proof (shell).** Save an ARIA snapshot and a screenshot under `artifacts/sign-in/`. The heading `Sign in to Tabaaq` and the `Email` textbox must be in both.
- **Continue with email.** Fill `Email` with a real mailbox the operator provided and choose `Continue`. Either the heading becomes `Enter your password`, `Enter your code`, or a registration heading, or an error alert explains the failure. Do not invent credentials.
- **Password.** On `Enter your password`, fill `Password` and choose `Sign in`. Success navigates to `/` with app chrome (Home / Products / Invoices). Failure stays on the password form with an error.
- **OTP.** On `Enter your code`, fill `One-time code`. If the description includes `Development code:`, use that value. Choose `Verify`. Success navigates to `/`.
- **Google.** Choose `Continue with Google`. The browser leaves the identifier form for the Google account picker or shows an error alert. Do not complete a personal Google login unless the operator asked.

## Gotchas

- Identify without the auth Worker yields a generic failure. That is not a product bug if doctor already reported `api down`.
- After a successful sign-in, `/sign-in` redirects to `/`. Re-verify the shell in a logged-out profile.
- OTP development codes appear in the form description only when the auth Worker has `AUTH_DEV_OTP` enabled. Production must not.
