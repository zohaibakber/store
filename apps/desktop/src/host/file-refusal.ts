import * as Schema from "effect/Schema";

export const FileRefusalReason = Schema.Literals([
  "failed",
  "no-workspace",
  "owner-only",
  "restore-local-only",
  "organization-backup",
  "unopenable-backup",
  "no-staged-restore",
  "release-too-long",
  "backup-not-opened",
  "backup-write-failed",
  "publish-needs-sign-in",
  "publish-needs-organization",
  "publish-local-open",
  "publish-underway",
  "nothing-to-move",
  "moved-before-changes",
  "moving-elsewhere",
  "unfinished-read",
]);
export type FileRefusalReason = typeof FileRefusalReason.Type;

export const WorkspaceStanding = Schema.Literals([
  "unchanged",
  "unchanged-closed",
  "previous-saved",
]);
export type WorkspaceStanding = typeof WorkspaceStanding.Type;

export class ReplicaFileRefused extends Schema.TaggedError<ReplicaFileRefused>()(
  "ReplicaFileRefused",
  {
    reason: FileRefusalReason,
    detail: Schema.optional(Schema.String),
    standing: Schema.optional(WorkspaceStanding),
    savedAs: Schema.optional(Schema.String),
  },
) {}
