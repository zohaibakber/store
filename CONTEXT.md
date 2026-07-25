# Store

The shared language for inventory, sales, and organization-scoped desktop operation.

## Language

**Authenticated Workspace**:
The signed-in user's selected organization together with its isolated local inventory and synchronization state. At most one authenticated workspace is active.
_Avoid_: Session, active organization

**Update Workflow**:
The main-process lifecycle that checks for application releases, coordinates a user-requested download, publishes progress, and installs a downloaded release.
_Avoid_: Updater timer, update hook
