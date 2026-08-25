import {
  EmailAddress,
  InvitationId,
  InvitationToken,
  OrganizationName,
  OrganizationSlug,
  type OrganizationCommand,
} from "@store/auth";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { AuthService } from "../src/service";
import {
  fakeRepository,
  harness,
  seedOrganization,
  seedSession,
  seedUser,
  type Harness,
} from "./harness";

type Api = ReturnType<typeof AuthService.of>;

const run = <A, E>(instance: Harness, use: (auth: Api) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* AuthService;
      return yield* use(auth);
    }).pipe(Effect.provide(instance.layer)),
  );

const command = (instance: Harness, accessToken: string, input: OrganizationCommand) =>
  run(instance, (auth) => auth.organize({ accessToken, command: input }));

const failing = (instance: Harness, accessToken: string, input: OrganizationCommand) =>
  run(instance, (auth) => Effect.flip(auth.organize({ accessToken, command: input })));

const accessTokenFor = (input: {
  readonly userId: string;
  readonly sessionId: string;
  readonly organizationId: string;
  readonly email: string;
  readonly role: "owner" | "admin" | "member";
  readonly organizationName?: string;
}) =>
  btoa(
    JSON.stringify({
      subject: input.userId,
      sessionId: input.sessionId,
      activeOrganizationId: input.organizationId,
      organizationName: input.organizationName ?? "Store",
      organizationSlug: null,
      role: input.role,
      email: input.email,
      name: input.email,
      image: null,
      expiresAt: Date.now() + 300_000,
    }),
  );

const withOwner = () => {
  const instance = harness();
  const owner = seedUser(instance.store, { id: "owner", email: "owner@example.com" });
  const organizationId = seedOrganization(instance.store, {
    id: "organization-1",
    name: "Owner Store",
    members: [{ userId: owner.id, role: "owner" }],
  });
  const session = seedSession(instance.store, {
    id: "session-owner",
    userId: owner.id,
    organizationId,
  });
  return {
    instance,
    owner,
    organizationId,
    session,
    token: accessTokenFor({
      userId: owner.id,
      sessionId: session.id,
      organizationId,
      email: owner.email,
      role: "owner",
      organizationName: "Owner Store",
    }),
  };
};

describe("organization invitations", () => {
  it("hands the inviter a token that the invited address can redeem", async () => {
    const { instance, token, organizationId } = withOwner();
    const invitee = seedUser(instance.store, { id: "invitee", email: "invitee@example.com" });
    seedOrganization(instance.store, {
      id: "organization-invitee",
      name: "Invitee Store",
      members: [{ userId: invitee.id, role: "owner" }],
    });
    const inviteeSession = seedSession(instance.store, {
      id: "session-invitee",
      userId: invitee.id,
      organizationId: instance.store.organizations[1]!.id,
    });

    const invited = await command(instance, token, {
      _tag: "InviteMember",
      organizationId,
      email: invitee.email,
      role: "admin",
    });
    expect(invited).toMatchObject({ _tag: "Invited" });
    if (invited._tag !== "Invited") throw new Error("expected an invitation");
    expect(instance.store.sentInvitations).toHaveLength(1);

    const accepted = await command(
      instance,
      accessTokenFor({
        userId: invitee.id,
        sessionId: inviteeSession.id,
        organizationId: inviteeSession.activeOrganizationId,
        email: invitee.email,
        role: "owner",
      }),
      { _tag: "AcceptInvitation", token: invited.token },
    );

    expect(accepted).toEqual({
      _tag: "Joined",
      organization: {
        id: organizationId,
        name: "Owner Store",
        slug: null,
        role: "admin",
      },
    });
    expect(
      instance.store.memberships.filter((entry) => entry.organizationId === organizationId),
    ).toHaveLength(2);
    expect(
      instance.store.sessions.find((entry) => entry.id === inviteeSession.id)?.activeOrganizationId,
    ).toBe(organizationId);
  });

  it("refuses a token presented by anyone but the invited address", async () => {
    const { instance, token, organizationId } = withOwner();
    const outsider = seedUser(instance.store, { id: "outsider", email: "outsider@example.com" });
    const outsiderOrganization = seedOrganization(instance.store, {
      id: "organization-outsider",
      name: "Outsider Store",
      members: [{ userId: outsider.id, role: "owner" }],
    });
    const outsiderSession = seedSession(instance.store, {
      id: "session-outsider",
      userId: outsider.id,
      organizationId: outsiderOrganization,
    });

    const invited = await command(instance, token, {
      _tag: "InviteMember",
      organizationId,
      email: EmailAddress.make("invitee@example.com"),
      role: "member",
    });
    if (invited._tag !== "Invited") throw new Error("expected an invitation");

    const failure = await failing(
      instance,
      accessTokenFor({
        userId: outsider.id,
        sessionId: outsiderSession.id,
        organizationId: outsiderOrganization,
        email: outsider.email,
        role: "owner",
      }),
      { _tag: "AcceptInvitation", token: invited.token },
    );

    expect(failure).toMatchObject({ status: 403, code: "INVITATION_EMAIL_MISMATCH" });
    expect(
      instance.store.memberships.filter((entry) => entry.organizationId === organizationId),
    ).toHaveLength(1);
  });

  it("spends an invitation once", async () => {
    const { instance, token, organizationId } = withOwner();
    const invitee = seedUser(instance.store, { id: "invitee", email: "invitee@example.com" });
    const inviteeOrganization = seedOrganization(instance.store, {
      id: "organization-invitee",
      name: "Invitee Store",
      members: [{ userId: invitee.id, role: "owner" }],
    });
    const inviteeSession = seedSession(instance.store, {
      id: "session-invitee",
      userId: invitee.id,
      organizationId: inviteeOrganization,
    });
    const inviteeToken = accessTokenFor({
      userId: invitee.id,
      sessionId: inviteeSession.id,
      organizationId: inviteeOrganization,
      email: invitee.email,
      role: "owner",
    });

    const invited = await command(instance, token, {
      _tag: "InviteMember",
      organizationId,
      email: invitee.email,
      role: "member",
    });
    if (invited._tag !== "Invited") throw new Error("expected an invitation");

    await command(instance, inviteeToken, {
      _tag: "AcceptInvitation",
      token: invited.token,
    });
    const second = await failing(instance, inviteeToken, {
      _tag: "AcceptInvitation",
      token: invited.token,
    });

    expect(second).toMatchObject({ status: 404, code: "INVITATION_NOT_FOUND" });
  });

  it("rejects a token nobody issued", async () => {
    const { instance, token } = withOwner();
    const failure = await failing(instance, token, {
      _tag: "AcceptInvitation",
      token: InvitationToken.make("not-a-real-token"),
    });
    expect(failure).toMatchObject({ status: 404, code: "INVITATION_NOT_FOUND" });
  });
});

describe("organization role guards", () => {
  const withTeam = () => {
    const instance = harness();
    const owner = seedUser(instance.store, { id: "owner", email: "owner@example.com" });
    const admin = seedUser(instance.store, { id: "admin", email: "admin@example.com" });
    const member = seedUser(instance.store, { id: "member", email: "member@example.com" });
    const organizationId = seedOrganization(instance.store, {
      id: "organization-1",
      name: "Store",
      members: [
        { userId: owner.id, role: "owner" },
        { userId: admin.id, role: "admin" },
        { userId: member.id, role: "member" },
      ],
    });
    for (const user of [owner, admin, member]) {
      seedSession(instance.store, {
        id: `session-${user.id}`,
        userId: user.id,
        organizationId,
      });
    }
    const tokenFor = (user: typeof owner, role: "owner" | "admin" | "member") =>
      accessTokenFor({
        userId: user.id,
        sessionId: `session-${user.id}`,
        organizationId,
        email: user.email,
        role,
      });
    return {
      instance,
      organizationId,
      owner,
      admin,
      member,
      ownerToken: tokenFor(owner, "owner"),
      adminToken: tokenFor(admin, "admin"),
      memberToken: tokenFor(member, "member"),
    };
  };

  it("lets only the owner change roles", async () => {
    const team = withTeam();

    const failure = await failing(team.instance, team.adminToken, {
      _tag: "ChangeMemberRole",
      organizationId: team.organizationId,
      userId: team.member.id,
      role: "admin",
    });
    expect(failure).toMatchObject({ status: 403, code: "INSUFFICIENT_ROLE" });

    const applied = await command(team.instance, team.ownerToken, {
      _tag: "ChangeMemberRole",
      organizationId: team.organizationId,
      userId: team.member.id,
      role: "admin",
    });
    expect(applied).toEqual({ _tag: "Applied" });
    expect(
      team.instance.store.memberships.find((entry) => entry.userId === team.member.id)?.role,
    ).toBe("admin");
  });

  it("keeps an organization from losing its last owner", async () => {
    const team = withTeam();
    const failure = await failing(team.instance, team.ownerToken, {
      _tag: "ChangeMemberRole",
      organizationId: team.organizationId,
      userId: team.owner.id,
      role: "member",
    });
    expect(failure).toMatchObject({ status: 409, code: "LAST_OWNER" });
  });

  it("lets one of two owners be removed and then keeps the remaining owner", async () => {
    const team = withTeam();
    const promoted = await command(team.instance, team.ownerToken, {
      _tag: "ChangeMemberRole",
      organizationId: team.organizationId,
      userId: team.admin.id,
      role: "owner",
    });
    expect(promoted).toEqual({ _tag: "Applied" });

    const removed = await command(team.instance, team.ownerToken, {
      _tag: "RemoveMember",
      organizationId: team.organizationId,
      userId: team.admin.id,
    });
    expect(removed).toEqual({ _tag: "Applied" });

    const demote = await failing(team.instance, team.ownerToken, {
      _tag: "ChangeMemberRole",
      organizationId: team.organizationId,
      userId: team.owner.id,
      role: "member",
    });
    expect(demote).toMatchObject({ status: 409, code: "LAST_OWNER" });
    expect(team.instance.store.memberships.filter((entry) => entry.role === "owner")).toHaveLength(
      1,
    );
  });

  it("does not delete the last owner from the membership table", async () => {
    const team = withTeam();
    const removed = await Effect.runPromise(
      fakeRepository(team.instance.store).removeMember({
        organizationId: team.organizationId,
        userId: team.owner.id,
      }),
    );
    expect(removed).toBe(false);
    expect(
      team.instance.store.memberships.some(
        (entry) => entry.userId === team.owner.id && entry.role === "owner",
      ),
    ).toBe(true);
  });

  it("lets an admin remove a member but not another admin", async () => {
    const team = withTeam();

    const refused = await failing(team.instance, team.adminToken, {
      _tag: "RemoveMember",
      organizationId: team.organizationId,
      userId: team.owner.id,
    });
    expect(refused).toMatchObject({ status: 403, code: "INSUFFICIENT_ROLE" });

    const applied = await command(team.instance, team.adminToken, {
      _tag: "RemoveMember",
      organizationId: team.organizationId,
      userId: team.member.id,
    });
    expect(applied).toEqual({ _tag: "Applied" });
    expect(team.instance.store.memberships.some((entry) => entry.userId === team.member.id)).toBe(
      false,
    );
  });

  it("hides an organization the caller does not belong to", async () => {
    const team = withTeam();
    const outsider = seedUser(team.instance.store, {
      id: "outsider",
      email: "outsider@example.com",
    });
    const elsewhere = seedOrganization(team.instance.store, {
      id: "organization-2",
      name: "Elsewhere",
      members: [{ userId: outsider.id, role: "owner" }],
    });

    const failure = await failing(team.instance, team.memberToken, {
      _tag: "InviteMember",
      organizationId: elsewhere,
      email: EmailAddress.make("someone@example.com"),
      role: "member",
    });
    expect(failure).toMatchObject({ status: 404, code: "ORGANIZATION_NOT_FOUND" });
  });

  it("refuses to revoke an invitation from another organization", async () => {
    const team = withTeam();
    const failure = await failing(team.instance, team.ownerToken, {
      _tag: "RevokeInvitation",
      organizationId: team.organizationId,
      invitationId: InvitationId.make("invitation-404"),
    });
    expect(failure).toMatchObject({ status: 404, code: "INVITATION_NOT_FOUND" });
  });

  it("lets an admin rename the organization but keeps a member out", async () => {
    const team = withTeam();

    const refused = await failing(team.instance, team.memberToken, {
      _tag: "UpdateOrganization",
      organizationId: team.organizationId,
      name: OrganizationName.make("Renamed"),
      slug: null,
    });
    expect(refused).toMatchObject({ status: 403, code: "INSUFFICIENT_ROLE" });

    const updated = await command(team.instance, team.adminToken, {
      _tag: "UpdateOrganization",
      organizationId: team.organizationId,
      name: OrganizationName.make("Renamed"),
      slug: OrganizationSlug.make("renamed"),
    });
    expect(updated).toEqual({
      _tag: "Updated",
      organization: {
        id: team.organizationId,
        name: "Renamed",
        slug: "renamed",
        role: "admin",
      },
    });
  });

  it("refuses a handle another store already uses", async () => {
    const team = withTeam();
    const stranger = seedUser(team.instance.store, {
      id: "stranger",
      email: "stranger@example.com",
    });
    seedOrganization(team.instance.store, {
      id: "organization-taken",
      name: "Taken",
      slug: "taken",
      members: [{ userId: stranger.id, role: "owner" }],
    });

    const failure = await failing(team.instance, team.ownerToken, {
      _tag: "UpdateOrganization",
      organizationId: team.organizationId,
      name: OrganizationName.make("Store"),
      slug: OrganizationSlug.make("taken"),
    });
    expect(failure).toMatchObject({ status: 409, code: "SLUG_TAKEN" });
  });
});

describe("the organization roster", () => {
  it("answers with the organization this session is signed in to", async () => {
    const { instance, token, organizationId } = withOwner();

    const roster = await run(instance, (auth) => auth.roster(token));

    expect(roster.organization).toEqual({
      id: organizationId,
      name: "Owner Store",
      slug: null,
      role: "owner",
    });
    expect(roster.members).toHaveLength(1);
  });

  it("keeps the pending invitation list away from plain members", async () => {
    const { instance, token, organizationId } = withOwner();
    const member = seedUser(instance.store, { id: "member", email: "member@example.com" });
    instance.store.memberships.push({
      organizationId,
      userId: member.id,
      role: "member",
      createdAt: 1,
    });
    const memberSession = seedSession(instance.store, {
      id: "session-member",
      userId: member.id,
      organizationId,
    });

    await command(instance, token, {
      _tag: "InviteMember",
      organizationId,
      email: EmailAddress.make("someone@example.com"),
      role: "member",
    });

    const asOwner = await run(instance, (auth) => auth.roster(token));
    const asMember = await run(instance, (auth) =>
      auth.roster(
        accessTokenFor({
          userId: member.id,
          sessionId: memberSession.id,
          organizationId,
          email: member.email,
          role: "member",
        }),
      ),
    );

    expect(asOwner.invitations).toHaveLength(1);
    expect(asOwner.members).toHaveLength(2);
    expect(asMember.invitations).toHaveLength(0);
    expect(asMember.members).toHaveLength(2);
  });

  it("turns away a request without a session", async () => {
    const instance = harness();
    const failure = await run(instance, (auth) => Effect.flip(auth.roster("not-a-token")));
    expect(failure).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });

  it("turns away a token whose session was revoked", async () => {
    const { instance, token, session } = withOwner();
    const index = instance.store.sessions.findIndex((entry) => entry.id === session.id);
    instance.store.sessions[index] = { ...session, revokedAt: Date.now() };

    const failure = await run(instance, (auth) => Effect.flip(auth.roster(token)));
    expect(failure).toMatchObject({ status: 401, code: "SESSION_REVOKED" });
  });
});
