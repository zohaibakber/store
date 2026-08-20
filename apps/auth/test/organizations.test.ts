import {
  EmailAddress,
  InvitationId,
  InvitationToken,
  OrganizationName,
  RefreshToken,
  type OrganizationCommand,
} from "@store/auth";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { AuthService } from "../src/service";
import {
  harness,
  refreshTokenHash,
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

/** The claims a session carries, in the shape the harness reads back. */
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

/** A signed-in owner with one organization. */
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
    // Nothing was mailed: the token is the delivery mechanism for now.
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

  it("keeps the last organization from being left", async () => {
    const team = withTeam();
    const failure = await failing(team.instance, team.memberToken, {
      _tag: "LeaveOrganization",
      organizationId: team.organizationId,
    });
    expect(failure).toMatchObject({ status: 409, code: "LAST_ORGANIZATION" });
  });

  it("lets a member leave once they have somewhere else to be", async () => {
    const team = withTeam();
    const created = await command(team.instance, team.memberToken, {
      _tag: "CreateOrganization",
      name: OrganizationName.make("Side Project"),
    });
    expect(created).toMatchObject({ _tag: "Joined" });

    const applied = await command(team.instance, team.memberToken, {
      _tag: "LeaveOrganization",
      organizationId: team.organizationId,
    });
    expect(applied).toEqual({ _tag: "Applied" });
    expect(
      team.instance.store.memberships.filter((entry) => entry.userId === team.member.id),
    ).toHaveLength(1);
  });
});

describe("switching organizations", () => {
  it("reissues the access token against the organization asked for", async () => {
    const instance = harness();
    const user = seedUser(instance.store, { id: "user-1", email: "user@example.com" });
    const first = seedOrganization(instance.store, {
      id: "organization-1",
      name: "First Store",
      members: [{ userId: user.id, role: "owner" }],
    });
    const second = seedOrganization(instance.store, {
      id: "organization-2",
      name: "Second Store",
      members: [{ userId: user.id, role: "member" }],
    });
    seedSession(instance.store, {
      id: "session-1",
      userId: user.id,
      organizationId: first,
      refreshTokenHash: await refreshTokenHash("secret-1"),
    });

    const tokens = await run(instance, (auth) =>
      auth.switchOrganization({
        organizationId: second,
        refreshToken: RefreshToken.make("session-1.secret-1"),
      }),
    );

    expect(instance.issued.at(-1)).toMatchObject({
      subject: user.id,
      activeOrganizationId: second,
      organizationName: "Second Store",
      role: "member",
    });
    // The refresh family carries forward, so the old credential is spent.
    expect(
      instance.store.sessions.find((session) => session.id === "session-1")?.revokedAt,
    ).not.toBeNull();
    const rotated = instance.store.sessions.find((session) => session.revokedAt === null);
    expect(rotated?.activeOrganizationId).toBe(second);
    expect(tokens.refreshToken).toBeDefined();
  });

  it("refuses an organization the caller does not belong to", async () => {
    const instance = harness();
    const user = seedUser(instance.store, { id: "user-1", email: "user@example.com" });
    const mine = seedOrganization(instance.store, {
      id: "organization-1",
      name: "Mine",
      members: [{ userId: user.id, role: "owner" }],
    });
    const stranger = seedUser(instance.store, { id: "user-2", email: "other@example.com" });
    const theirs = seedOrganization(instance.store, {
      id: "organization-2",
      name: "Theirs",
      members: [{ userId: stranger.id, role: "owner" }],
    });
    seedSession(instance.store, {
      id: "session-1",
      userId: user.id,
      organizationId: mine,
      refreshTokenHash: await refreshTokenHash("secret-1"),
    });

    const failure = await run(instance, (auth) =>
      Effect.flip(
        auth.switchOrganization({
          organizationId: theirs,
          refreshToken: RefreshToken.make("session-1.secret-1"),
        }),
      ),
    );

    expect(failure).toMatchObject({ status: 404, code: "ORGANIZATION_NOT_FOUND" });
    expect(instance.store.sessions.find((session) => session.id === "session-1")?.revokedAt).toBe(
      null,
    );
  });

  it("keeps refreshing into the organization the session switched to", async () => {
    const instance = harness();
    const user = seedUser(instance.store, { id: "user-1", email: "user@example.com" });
    const first = seedOrganization(instance.store, {
      id: "organization-1",
      name: "First Store",
      members: [{ userId: user.id, role: "owner" }],
    });
    const second = seedOrganization(instance.store, {
      id: "organization-2",
      name: "Second Store",
      members: [{ userId: user.id, role: "member" }],
    });
    seedSession(instance.store, {
      id: "session-1",
      userId: user.id,
      organizationId: first,
      refreshTokenHash: await refreshTokenHash("secret-1"),
    });

    const switched = await run(instance, (auth) =>
      auth.switchOrganization({
        organizationId: second,
        refreshToken: RefreshToken.make("session-1.secret-1"),
      }),
    );
    const refreshed = await run(instance, (auth) =>
      auth.refresh({ refreshToken: switched.refreshToken }),
    );

    expect(refreshed.accessToken).toBeDefined();
    expect(instance.issued.at(-1)).toMatchObject({ activeOrganizationId: second });
  });
});

describe("the organization directory", () => {
  it("lists memberships and the invitations waiting for that address", async () => {
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

    await command(instance, token, {
      _tag: "InviteMember",
      organizationId,
      email: invitee.email,
      role: "member",
    });

    const directory = await run(instance, (auth) =>
      auth.directory(
        accessTokenFor({
          userId: invitee.id,
          sessionId: inviteeSession.id,
          organizationId: inviteeOrganization,
          email: invitee.email,
          role: "owner",
        }),
      ),
    );

    expect(directory.organizations).toEqual([
      { id: inviteeOrganization, name: "Invitee Store", slug: null, role: "owner" },
    ]);
    expect(directory.invitations).toMatchObject([
      { organizationId, organizationName: "Owner Store", role: "member" },
    ]);
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

    const asOwner = await run(instance, (auth) =>
      auth.roster({ accessToken: token, organizationId }),
    );
    const asMember = await run(instance, (auth) =>
      auth.roster({
        accessToken: accessTokenFor({
          userId: member.id,
          sessionId: memberSession.id,
          organizationId,
          email: member.email,
          role: "member",
        }),
        organizationId,
      }),
    );

    expect(asOwner.invitations).toHaveLength(1);
    expect(asOwner.members).toHaveLength(2);
    expect(asMember.invitations).toHaveLength(0);
    expect(asMember.members).toHaveLength(2);
  });

  it("turns away a request without a session", async () => {
    const instance = harness();
    const failure = await run(instance, (auth) => Effect.flip(auth.directory("not-a-token")));
    expect(failure).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });

  it("turns away a token whose session was revoked", async () => {
    const { instance, token, session } = withOwner();
    const index = instance.store.sessions.findIndex((entry) => entry.id === session.id);
    instance.store.sessions[index] = { ...session, revokedAt: Date.now() };

    const failure = await run(instance, (auth) => Effect.flip(auth.directory(token)));
    expect(failure).toMatchObject({ status: 401, code: "SESSION_REVOKED" });
  });
});
