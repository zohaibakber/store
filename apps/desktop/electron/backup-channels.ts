import type { WorkspaceBackupBridge } from "../src/lib/workspace-backup";

export const BACKUP_SAVE_CHANNEL = "backup:save";
export const RESTORE_CHOOSE_CHANNEL = "backup:choose-restore";
export const RESTORE_APPLY_CHANNEL = "backup:apply-restore";
export const RESTORE_DISCARD_CHANNEL = "backup:discard-restore";

export type WorkspaceBackupIpcBridge = WorkspaceBackupBridge;
