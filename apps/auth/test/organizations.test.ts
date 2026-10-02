import {
  EmailAddress,
  OrganizationName,
  type AccessToken,
  type OrganizationCommand,
  type OrganizationId,
  type OrganizationRole,
} from "@store/auth";
import { describe, expect, it } from "vitest";

import { count, failing, harness, refreshWith, run, signUp, type Harness } from "./harness";

const command = (instance: Harness, accessToken: AccessToken, input: OrganizationCommand) =>
  run(instance, (auth) => auth.organize({ accessToken, command: input }));

const refused = (instance: Harness, accessToken: AccessToken, input: OrganizationCommand) =>
  failing(instance, (auth) => auth.organize({ accessToken, command: input }));

type InvitableRole = Exclude<OrganizationRole, "owner">;

const invite = async (
  instance: Harness,
  accessToken: AccessToken,
  organizationId: OrganizationId,
  email: string,
  role: InvitableRole,
) => {
  const invited = await command(instance, accessToken, {
    _tag: "InviteMember",
    organizationId,
    email: EmailAddress.make(email),
    role,
  });
  if (invited._tag !== "Invited") throw new Error("expected an invitation");
  return invited;
};

const withOwner = async () => {
  const instance = harness();
  const owner = await signUp(instance, "owner@example.com");
  return {
    instance,
    owner,
    ownerId: owner.workspace.user.id,
    organizationId: owner.workspace.activeOrganization.id,
  };
};

const memberships = (instance: Harness, organizationId: OrganizationId, where = "1 = 1") =>
  count(
    instance,
    `SELECT count(*) AS total FROM auth_organization_membership WHERE organizationId = ? AND ${where}`,
    organizationId,
  );

const withTeam = async () => {
  const base = await withOwner();
  const join = async (email: string, role: InvitableRole) => {
    const session = await signUp(base.instance, email);
    const invited = await invite(
      base.instance,
      base.owner.accessToken,
      base.organizationId,
      email,
      role,
    );
    await command(base.instance, session.accessToken, {
      _tag: "AcceptInvitation",
      token: invited.token,
    });
    const joined = await refreshWith(base.instance, session.refreshToken);
    if (joined._tag !== "Success") throw new Error("expected a refreshed session");
    return { id: session.workspace.user.id, accessToken: joined.success.accessToken };
  };
  return {
    ...base,
    admin: await join("admin@example.com", "admin"),
    member: await join("member@example.com", "member"),
  };
};

describe("organization invitations", () => {
  it("refuses a token presented by anyone but the invited address", async () => {
    const { instance, owner, organizationId } = await withOwner();
    const outsider = await signUp(instance, "outsider@example.com");
    const invited = await invite(
      instance,
      owner.accessToken,
      organizationId,
      "invitee@example.com",
      "member",
    );

    const failure = await refused(instance, outsider.accessToken, {
      _tag: "AcceptInvitation",
      token: invited.token,
    });

    expect(failure).toMatchObject({ status: 403, code: "INVITATION_EMAIL_MISMATCH" });
    expect(memberships(instance, organizationId)).toBe(1);
  });

  it("spends an invitation once, for the invited role", async () => {
    const { instance, owner, organizationId } = await withOwner();
    const invitee = await signUp(instance, "invitee@example.com");
    const invited = await invite(
      instance,
      owner.accessToken,
      organizationId,
      "invitee@example.com",
      "admin",
    );
    const accept: OrganizationCommand = { _tag: "AcceptInvitation", token: invited.token };

    const joined = await command(instance, invitee.accessToken, accept);
    const second = await refused(instance, invitee.accessToken, accept);

    expect(joined).toMatchObject({ _tag: "Joined", organization: { id: organizationId } });
    expect(second).toMatchObject({ status: 404, code: "INVITATION_NOT_FOUND" });
    expect(memberships(instance, organizationId)).toBe(2);
    expect(memberships(instance, organizationId, "role = 'admin'")).toBe(1);
  });
});

describe("organization role guards", () => {
  it("keeps role changes, removals of the owner, and renames away from lesser roles", async () => {
    const team = await withTeam();

    const promote = await refused(team.instance, team.admin.accessToken, {
      _tag: "ChangeMemberRole",
      organizationId: team.organizationId,
      userId: team.member.id,
      role: "admin",
    });
    const removeOwner = await refused(team.instance, team.admin.accessToken, {
      _tag: "RemoveMember",
      organizationId: team.organizationId,
      userId: team.ownerId,
    });
    const rename = await refused(team.instance, team.member.accessToken, {
      _tag: "UpdateOrganization",
      organizationId: team.organizationId,
      name: OrganizationName.make("Renamed"),
    });

    for (const failure of [promote, removeOwner, rename]) {
      expect(failure).toMatchObject({ status: 403, code: "INSUFFICIENT_ROLE" });
    }
    expect(memberships(team.instance, team.organizationId, "role = 'member'")).toBe(1);
    expect(memberships(team.instance, team.organizationId, "role = 'owner'")).toBe(1);
    expect(team.instance.revocations).toEqual([]);
  });

  it("lets one of two owners be removed and then keeps the remaining owner", async () => {
    const team = await withTeam();
    await command(team.instance, team.owner.accessToken, {
      _tag: "ChangeMemberRole",
      organizationId: team.organizationId,
      userId: team.admin.id,
      role: "owner",
    });
    const removed = await command(team.instance, team.owner.accessToken, {
      _tag: "RemoveMember",
      organizationId: team.organizationId,
      userId: team.admin.id,
    });
    expect(removed).toEqual({ _tag: "Applied" });

    const demote = await refused(team.instance, team.owner.accessToken, {
      _tag: "ChangeMemberRole",
      organizationId: team.organizationId,
      userId: team.ownerId,
      role: "member",
    });

    expect(demote).toMatchObject({ status: 409, code: "LAST_OWNER" });
    expect(memberships(team.instance, team.organizationId, "role = 'owner'")).toBe(1);
  });

  it("ends a removed member's sessions and sockets, and nobody else's", async () => {
    const team = await withTeam();

    const applied = await command(team.instance, team.admin.accessToken, {
      _tag: "RemoveMember",
      organizationId: team.organizationId,
      userId: team.member.id,
    });
    expect(applied).toEqual({ _tag: "Applied" });
    expect(memberships(team.instance, team.organizationId)).toBe(2);
    expect(team.instance.revocations).toEqual([
      { organizationId: team.organizationId, userId: team.member.id },
    ]);

    const removed = await failing(team.instance, (auth) => auth.roster(team.member.accessToken));
    expect(removed).toMatchObject({ status: 401, code: "SESSION_REVOKED" });
    const kept = await run(team.instance, (auth) => auth.roster(team.admin.accessToken));
    expect(kept.members).toHaveLength(2);
  });

  it("closes the live sockets of a demoted member but not of a promoted one", async () => {
    const team = await withTeam();
    const changeRole = (userId: typeof team.ownerId, role: OrganizationRole) =>
      command(team.instance, team.owner.accessToken, {
        _tag: "ChangeMemberRole",
        organizationId: team.organizationId,
        userId,
        role,
      });

    await changeRole(team.member.id, "admin");
    expect(team.instance.revocations).toEqual([]);

    await changeRole(team.admin.id, "member");
    expect(team.instance.revocations).toEqual([
      { organizationId: team.organizationId, userId: team.admin.id },
    ]);
  });

  it("hides an organization the caller does not belong to", async () => {
    const team = await withTeam();
    const outsider = await signUp(team.instance, "outsider@example.com");

    const failure = await refused(team.instance, team.member.accessToken, {
      _tag: "InviteMember",
      organizationId: outsider.workspace.activeOrganization.id,
      email: EmailAddress.make("someone@example.com"),
      role: "member",
    });
    expect(failure).toMatchObject({ status: 404, code: "ORGANIZATION_NOT_FOUND" });
    expect(count(team.instance, "SELECT count(*) AS total FROM auth_organization_invitation")).toBe(
      2,
    );
  });

  it("keeps the pending invitation list away from plain members", async () => {
    const team = await withTeam();
    await invite(
      team.instance,
      team.owner.accessToken,
      team.organizationId,
      "someone@example.com",
      "member",
    );

    const asOwner = await run(team.instance, (auth) => auth.roster(team.owner.accessToken));
    const asMember = await run(team.instance, (auth) => auth.roster(team.member.accessToken));

    expect(asOwner.invitations).toHaveLength(1);
    expect(asMember.invitations).toHaveLength(0);
    expect(asMember.organization).toMatchObject({ id: team.organizationId, role: "member" });
  });
});
