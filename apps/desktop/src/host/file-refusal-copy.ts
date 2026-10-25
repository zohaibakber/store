import type { ReplicaFileRefused } from "./file-refusal";

const reasonCopy = (refusal: ReplicaFileRefused): string => {
  switch (refusal.reason) {
    case "failed":
      return refusal.detail ?? "";
    case "no-workspace":
      return "Open a workspace before using backups.";
    case "owner-only":
      return "Only the owner can do this. Unlock as the owner and try again.";
    case "restore-local-only":
      return "Only the workspace on this device can be restored from a file.";
    case "organization-backup":
      return "This backup is a copy of an organization's data. Only a backup of this device's own workspace can be restored here.";
    case "unopenable-backup":
      return "This backup could not be opened by this version of Tabaaq.";
    case "no-staged-restore":
      return "Choose a backup file first.";
    case "release-too-long":
      return "The local database took too long to close.";
    case "backup-not-opened":
      return "The backup could not be opened.";
    case "backup-write-failed":
      return `The backup could not be written. ${refusal.detail ?? ""}`;
    case "publish-needs-sign-in":
      return "Sign in to an organization to move this device's data.";
    case "publish-needs-organization":
      return "Open the organization that should receive this device's data.";
    case "publish-local-open":
      return "Close the workspace on this device before moving its data.";
    case "publish-underway":
      return "This device's data is already being moved.";
    case "nothing-to-move":
      return "This device has no data to move.";
    case "moved-before-changes":
      return "This device's data was already moved to this organization. Changes made on this device since then are not in the organization and stay under This device.";
    case "moving-elsewhere":
      return "This device's data is already being moved to another organization. Open that organization to finish, or cancel that move.";
    case "unfinished-read":
      return "This device's data could not be read to the end. Try again.";
  }
};

export const fileRefusalMessage = (refusal: ReplicaFileRefused): string => {
  const reason = reasonCopy(refusal);
  switch (refusal.standing) {
    case undefined:
      return reason;
    case "unchanged":
      return `${reason} Your workspace is unchanged.`;
    case "unchanged-closed":
      return `${reason} Your workspace is unchanged. Restart Tabaaq to open it.`;
    case "previous-saved":
      return `${reason} Your previous workspace is saved as ${refusal.savedAs ?? ""}.`;
  }
};
