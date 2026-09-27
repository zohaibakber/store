import * as Schema from "effect/Schema";

import { OrganizationId, UserId } from "./ids";

export const WorkspaceUser = Schema.Struct({
  id: UserId,
  name: Schema.String,
  email: Schema.String,
  image: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export interface WorkspaceUser extends Schema.Schema.Type<typeof WorkspaceUser> {}

export const WorkspaceOrganization = Schema.Struct({
  id: OrganizationId,
  name: Schema.String,
  slug: Schema.optionalKey(Schema.NullOr(Schema.String)),
  image: Schema.optionalKey(Schema.NullOr(Schema.String)),
  role: Schema.String,
});

export interface WorkspaceOrganization extends Schema.Schema.Type<typeof WorkspaceOrganization> {}

const workspaceCommon = {
  organizations: Schema.Array(WorkspaceOrganization),
  isOnline: Schema.Boolean,
  workspaceError: Schema.optionalKey(Schema.NullOr(Schema.String)),
};

export const AuthenticatedWorkspaceSnapshot = Schema.Struct({
  status: Schema.Literal("authenticated"),
  user: WorkspaceUser,
  activeOrganization: Schema.NullOr(WorkspaceOrganization),
  ...workspaceCommon,
});

export interface AuthenticatedWorkspaceSnapshot extends Schema.Schema.Type<
  typeof AuthenticatedWorkspaceSnapshot
> {}

export const UnauthenticatedWorkspaceSnapshot = Schema.Struct({
  status: Schema.Literal("unauthenticated"),
  user: Schema.Null,
  activeOrganization: Schema.Null,
  ...workspaceCommon,
});

export interface UnauthenticatedWorkspaceSnapshot extends Schema.Schema.Type<
  typeof UnauthenticatedWorkspaceSnapshot
> {}

export const WorkspaceSnapshot = Schema.Union([
  AuthenticatedWorkspaceSnapshot,
  UnauthenticatedWorkspaceSnapshot,
]);

export type WorkspaceSnapshot = typeof WorkspaceSnapshot.Type;

export const decodeAuthenticatedWorkspace = Schema.decodeUnknownSync(
  AuthenticatedWorkspaceSnapshot,
);

export const unauthenticatedWorkspace = (input: {
  readonly isOnline: boolean;
  readonly workspaceError?: string | null;
}): UnauthenticatedWorkspaceSnapshot => {
  const snapshot = {
    status: "unauthenticated" as const,
    user: null,
    activeOrganization: null,
    organizations: [],
    isOnline: input.isOnline,
  };
  if (input.workspaceError === undefined) return snapshot;
  return { ...snapshot, workspaceError: input.workspaceError };
};

export const withWorkspaceOnline = (
  snapshot: WorkspaceSnapshot,
  isOnline: boolean,
): WorkspaceSnapshot =>
  snapshot.status === "authenticated" ? { ...snapshot, isOnline } : { ...snapshot, isOnline };

export const withWorkspaceError = (
  snapshot: WorkspaceSnapshot,
  workspaceError: string | null,
): WorkspaceSnapshot =>
  snapshot.status === "authenticated"
    ? { ...snapshot, workspaceError }
    : { ...snapshot, workspaceError };
