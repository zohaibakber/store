import { describe, expect, it } from "@effect/vitest";
import {
  EmailAddress,
  OrganizationName,
  type AccessToken,
  type OrganizationCommand,
  type OrganizationId,
  type OrganizationRole,
} from "@store/auth";
import * as Effect from "effect/Effect";

import { AuthApi, AuthTest, count, refreshWith, refusal, scenario, signUp } from "./harness";

const command = (accessToken: AccessToken, input: OrganizationCommand) =>
  AuthApi.use((auth) => auth.organize({ accessToken, command: input }));

const refused = (accessToken: AccessToken, input: OrganizationCommand) =>
  refusal(command(accessToken, input));

type InvitableRole = Exclude<OrganizationRole, "owner">;

const invite = Effect.fn("invite")(function* (
  accessToken: AccessToken,
  organizationId: OrganizationId,
  email: string,
  role: InvitableRole,
) {
  const invited = yield* command(accessToken, {
    _tag: "InviteMember",
    organizationId,
    email: EmailAddress.make(email),
    role,
  });
  if (invited._tag !== "Invited") return yield* Effect.die(new Error("expected an invitation"));
  return invited;
});

const withOwner = Effect.gen(function* () {
  const owner = yield* signUp("owner@example.com");
  return {
    owner,
    ownerId: owner.workspace.user.id,
    organizationId: owner.workspace.activeOrganization.id,
  };
});

const memberships = (organizationId: OrganizationId, where = "1 = 1") =>
  count(
    `SELECT count(*) AS total FROM auth_organization_membership WHERE organizationId = ? AND ${where}`,
    organizationId,
  );

const withTeam = Effect.gen(function* () {
  const base = yield* withOwner;
  const join = Effect.fn("join")(function* (email: string, role: InvitableRole) {
    const session = yield* signUp(email);
    const invited = yield* invite(base.owner.accessToken, base.organizationId, email, role);
    yield* command(session.accessToken, { _tag: "AcceptInvitation", token: invited.token });
    const joined = yield* refreshWith(session.refreshToken);
    if (joined._tag !== "Success") {
      return yield* Effect.die(new Error("expected a refreshed session"));
    }
    return { id: session.workspace.user.id, accessToken: joined.success.accessToken };
  });
  return {
    ...base,
    admin: yield* join("admin@example.com", "admin"),
    member: yield* join("member@example.com", "member"),
  };
});

describe("organization invitations", () => {
  it.effect("refuses a token presented by anyone but the invited address", () =>
    Effect.gen(function* () {
      const { owner, organizationId } = yield* withOwner;
      const outsider = yield* signUp("outsider@example.com");
      const invited = yield* invite(
        owner.accessToken,
        organizationId,
        "invitee@example.com",
        "member",
      );

      const failure = yield* refused(outsider.accessToken, {
        _tag: "AcceptInvitation",
        token: invited.token,
      });

      expect(failure).toMatchObject({ status: 403, code: "INVITATION_EMAIL_MISMATCH" });
      expect(yield* memberships(organizationId)).toBe(1);
    }).pipe(scenario()),
  );

  it.effect("spends an invitation once, for the invited role", () =>
    Effect.gen(function* () {
      const { owner, organizationId } = yield* withOwner;
      const invitee = yield* signUp("invitee@example.com");
      const invited = yield* invite(
        owner.accessToken,
        organizationId,
        "invitee@example.com",
        "admin",
      );
      const accept: OrganizationCommand = { _tag: "AcceptInvitation", token: invited.token };

      const joined = yield* command(invitee.accessToken, accept);
      const second = yield* refused(invitee.accessToken, accept);

      expect(joined).toMatchObject({ _tag: "Joined", organization: { id: organizationId } });
      expect(second).toMatchObject({ status: 404, code: "INVITATION_NOT_FOUND" });
      expect(yield* memberships(organizationId)).toBe(2);
      expect(yield* memberships(organizationId, "role = 'admin'")).toBe(1);
    }).pipe(scenario()),
  );
});

describe("organization role guards", () => {
  it.effect("keeps role changes, removals of the owner, and renames away from lesser roles", () =>
    Effect.gen(function* () {
      const team = yield* withTeam;
      const control = yield* AuthTest;

      const promote = yield* refused(team.admin.accessToken, {
        _tag: "ChangeMemberRole",
        organizationId: team.organizationId,
        userId: team.member.id,
        role: "admin",
      });
      const removeOwner = yield* refused(team.admin.accessToken, {
        _tag: "RemoveMember",
        organizationId: team.organizationId,
        userId: team.ownerId,
      });
      const rename = yield* refused(team.member.accessToken, {
        _tag: "UpdateOrganization",
        organizationId: team.organizationId,
        name: OrganizationName.make("Renamed"),
      });

      for (const failure of [promote, removeOwner, rename]) {
        expect(failure).toMatchObject({ status: 403, code: "INSUFFICIENT_ROLE" });
      }
      expect(yield* memberships(team.organizationId, "role = 'member'")).toBe(1);
      expect(yield* memberships(team.organizationId, "role = 'owner'")).toBe(1);
      expect(yield* control.revocations).toEqual([]);
    }).pipe(scenario()),
  );

  it.effect("lets one of two owners be removed and then keeps the remaining owner", () =>
    Effect.gen(function* () {
      const team = yield* withTeam;
      yield* command(team.owner.accessToken, {
        _tag: "ChangeMemberRole",
        organizationId: team.organizationId,
        userId: team.admin.id,
        role: "owner",
      });
      const removed = yield* command(team.owner.accessToken, {
        _tag: "RemoveMember",
        organizationId: team.organizationId,
        userId: team.admin.id,
      });
      expect(removed).toEqual({ _tag: "Applied" });

      const demote = yield* refused(team.owner.accessToken, {
        _tag: "ChangeMemberRole",
        organizationId: team.organizationId,
        userId: team.ownerId,
        role: "member",
      });

      expect(demote).toMatchObject({ status: 409, code: "LAST_OWNER" });
      expect(yield* memberships(team.organizationId, "role = 'owner'")).toBe(1);
    }).pipe(scenario()),
  );

  it.effect("ends a removed member's sessions and sockets, and nobody else's", () =>
    Effect.gen(function* () {
      const team = yield* withTeam;
      const control = yield* AuthTest;

      const applied = yield* command(team.admin.accessToken, {
        _tag: "RemoveMember",
        organizationId: team.organizationId,
        userId: team.member.id,
      });
      expect(applied).toEqual({ _tag: "Applied" });
      expect(yield* memberships(team.organizationId)).toBe(2);
      expect(yield* control.revocations).toEqual([
        { organizationId: team.organizationId, userId: team.member.id },
      ]);

      const removed = yield* refusal(AuthApi.use((auth) => auth.roster(team.member.accessToken)));
      expect(removed).toMatchObject({ status: 401, code: "SESSION_REVOKED" });
      const kept = yield* AuthApi.use((auth) => auth.roster(team.admin.accessToken));
      expect(kept.members).toHaveLength(2);
    }).pipe(scenario()),
  );

  it.effect("closes the live sockets of a demoted member but not of a promoted one", () =>
    Effect.gen(function* () {
      const team = yield* withTeam;
      const control = yield* AuthTest;
      const changeRole = (userId: typeof team.ownerId, role: OrganizationRole) =>
        command(team.owner.accessToken, {
          _tag: "ChangeMemberRole",
          organizationId: team.organizationId,
          userId,
          role,
        });

      yield* changeRole(team.member.id, "admin");
      expect(yield* control.revocations).toEqual([]);

      yield* changeRole(team.admin.id, "member");
      expect(yield* control.revocations).toEqual([
        { organizationId: team.organizationId, userId: team.admin.id },
      ]);
    }).pipe(scenario()),
  );

  it.effect("hides an organization the caller does not belong to", () =>
    Effect.gen(function* () {
      const team = yield* withTeam;
      const outsider = yield* signUp("outsider@example.com");

      const failure = yield* refused(team.member.accessToken, {
        _tag: "InviteMember",
        organizationId: outsider.workspace.activeOrganization.id,
        email: EmailAddress.make("someone@example.com"),
        role: "member",
      });
      expect(failure).toMatchObject({ status: 404, code: "ORGANIZATION_NOT_FOUND" });
      expect(yield* count("SELECT count(*) AS total FROM auth_organization_invitation")).toBe(2);
    }).pipe(scenario()),
  );

  it.effect("keeps the pending invitation list away from plain members", () =>
    Effect.gen(function* () {
      const team = yield* withTeam;
      yield* invite(team.owner.accessToken, team.organizationId, "someone@example.com", "member");

      const asOwner = yield* AuthApi.use((auth) => auth.roster(team.owner.accessToken));
      const asMember = yield* AuthApi.use((auth) => auth.roster(team.member.accessToken));

      expect(asOwner.invitations).toHaveLength(1);
      expect(asMember.invitations).toHaveLength(0);
      expect(asMember.organization).toMatchObject({ id: team.organizationId, role: "member" });
    }).pipe(scenario()),
  );
});
