# Store

Shared vocabulary for inventory, sales, and how the desktop scopes work to an
organization.

## Language

**Authenticated workspace.**
The signed-in user's selected organization, plus its isolated local inventory
and sync state. At most one authenticated workspace is active.
_Avoid_: Session, active organization

**Update workflow.**
Main-process lifecycle that checks for releases, runs a user-requested download,
publishes progress, and installs the downloaded build.
_Avoid_: Updater timer, update hook
