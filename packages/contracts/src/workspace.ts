import * as Schema from "effect/Schema";

export const WorkspaceUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  image: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export interface WorkspaceUser extends Schema.Schema.Type<typeof WorkspaceUser> {}

export const WorkspaceOrganization = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.optionalKey(Schema.NullOr(Schema.String)),
  role: Schema.String,
});

export interface WorkspaceOrganization extends Schema.Schema.Type<typeof WorkspaceOrganization> {}

export const WorkspaceSnapshot = Schema.Struct({
  status: Schema.Literals(["authenticated", "unauthenticated"]),
  user: Schema.NullOr(WorkspaceUser),
  activeOrganization: Schema.NullOr(WorkspaceOrganization),
  organizations: Schema.Array(WorkspaceOrganization),
  isOnline: Schema.Boolean,
  workspaceError: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export interface WorkspaceSnapshot extends Schema.Schema.Type<typeof WorkspaceSnapshot> {}
