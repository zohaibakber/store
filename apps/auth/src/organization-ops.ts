import {
  AuthOrganizationMembership,
  EmailAddress,
  InvitationToken,
  normalizeEmail,
  OrganizationInvitation,
  OrganizationRoster,
  type AccessClaims,
  type EmailProviderApi,
  type OrganizationCommand,
  type OrganizationId,
  type OrganizationRole,
  type OrganizationSlug,
  type UserId,
} from "@store/auth";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import { hashInvitationSecret, INVITATION_TTL_MS, randomSecret } from "./crypto";
import { authError } from "./errors";
import { enforceAuthLimit, type AuthLimits } from "./limits";
import { type AuthRepositoryApi, type InvitationRecord, type MembershipRecord } from "./repository";
import type { SessionOps } from "./session-ops";

export interface OrganizationOpsConfiguration {
  readonly refreshTokenPepper: string;
}

export const makeOrganizationOps = (
  repository: AuthRepositoryApi,
  email: EmailProviderApi,
  sessions: Pick<SessionOps, "authorize">,
  configuration: OrganizationOpsConfiguration,
  limits: AuthLimits,
) => {
  const hashInvite = (secret: string) =>
    hashInvitationSecret(configuration.refreshTokenPepper, secret);

  const membershipOf = Effect.fn("Auth.Organization.membershipOf")(function* (
    userId: UserId,
    organizationId: OrganizationId,
  ) {
    const membership = yield* repository.membershipInOrganization({ userId, organizationId });
    if (!membership) {
      return yield* authError(404, "ORGANIZATION_NOT_FOUND", "This organization is not yours.");
    }
    return membership;
  });

  const requireRole = Effect.fn("Auth.Organization.requireRole")(function* (
    userId: UserId,
    organizationId: OrganizationId,
    allowed: ReadonlyArray<OrganizationRole>,
  ) {
    const membership = yield* membershipOf(userId, organizationId);
    if (!allowed.includes(membership.role)) {
      return yield* authError(
        403,
        "INSUFFICIENT_ROLE",
        allowed.length === 1 && allowed[0] === "owner"
          ? "Only the organization owner can do this."
          : "You do not have permission to do this.",
      );
    }
    return membership;
  });

  const membershipView = (membership: MembershipRecord) =>
    AuthOrganizationMembership.make({
      id: membership.organizationId,
      name: membership.organizationName,
      slug: membership.organizationSlug,
      role: membership.role,
    });

  const invitationView = (invitation: InvitationRecord) =>
    OrganizationInvitation.make({
      id: invitation.id,
      organizationId: invitation.organizationId,
      organizationName: invitation.organizationName,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    });

  const roster = Effect.fn("Auth.Organization.roster")(function* (accessToken: string) {
    const now = yield* Clock.currentTimeMillis;
    const claims = yield* sessions.authorize(accessToken);
    const membership = yield* membershipOf(claims.subject, claims.activeOrganizationId);
    const members = yield* repository.listMembers(claims.activeOrganizationId);
    const invitations =
      membership.role === "member"
        ? []
        : yield* repository.pendingInvitationsForOrganization({
            organizationId: claims.activeOrganizationId,
            now,
          });
    return OrganizationRoster.make({
      organization: membershipView(membership),
      members,
      invitations: invitations.map(invitationView),
    });
  });

  const updateOrganization = Effect.fn("Auth.Organization.updateOrganization")(function* (
    claims: AccessClaims,
    input: {
      readonly organizationId: OrganizationId;
      readonly name: string;
      readonly slug: OrganizationSlug | null;
    },
  ) {
    const membership = yield* requireRole(claims.subject, input.organizationId, ["owner", "admin"]);
    const updated = yield* repository.updateOrganization({
      organizationId: input.organizationId,
      name: input.name,
      slug: input.slug,
      role: membership.role,
    });
    if (!updated) {
      return yield* authError(409, "SLUG_TAKEN", "Another store already uses that handle.");
    }
    return { _tag: "Updated", organization: membershipView(updated) } as const;
  });

  const inviteMember = Effect.fn("Auth.Organization.inviteMember")(function* (
    claims: AccessClaims,
    input: {
      readonly organizationId: OrganizationId;
      readonly email: typeof EmailAddress.Type;
      readonly role: OrganizationRole;
    },
  ) {
    const now = yield* Clock.currentTimeMillis;
    yield* requireRole(claims.subject, input.organizationId, ["owner", "admin"]);
    const address = EmailAddress.make(normalizeEmail(input.email));
    const members = yield* repository.listMembers(input.organizationId);
    if (members.some((member) => member.email === address)) {
      return yield* authError(
        409,
        "ALREADY_A_MEMBER",
        "This person is already in the organization.",
      );
    }
    const secret = yield* randomSecret(32);
    const tokenHash = yield* hashInvite(secret);
    const expiresAt = now + INVITATION_TTL_MS;
    const invitation = yield* repository.createInvitation({
      organizationId: input.organizationId,
      email: address,
      role: input.role,
      tokenHash,
      invitedByUserId: claims.subject,
      expiresAt,
      now,
    });
    yield* email
      .sendInvitation({
        email: address,
        organizationName: invitation.organizationName,
        role: invitation.role,
        invitedBy: claims.name,
        token: InvitationToken.make(secret),
        expiresAt,
      })
      .pipe(
        Effect.catchTag("Auth.EmailDeliveryError", (cause) =>
          Effect.logWarning("auth.invitation_delivery_failed").pipe(
            Effect.annotateLogs({ invitation: invitation.id, message: cause.message }),
          ),
        ),
      );
    return {
      _tag: "Invited",
      invitation: invitationView(invitation),
      token: InvitationToken.make(secret),
    } as const;
  });

  const acceptInvitation = Effect.fn("Auth.Organization.acceptInvitation")(function* (
    claims: AccessClaims,
    token: string,
  ) {
    const now = yield* Clock.currentTimeMillis;
    yield* enforceAuthLimit(
      limits.tenPerMinute,
      `accept-invitation:${claims.subject}`,
      "Wait before trying another invitation.",
    );
    const tokenHash = yield* hashInvite(token);
    const invitation = yield* repository.findInvitationByTokenHash(tokenHash);
    const expired = invitation !== null && invitation.expiresAt <= now;
    const spent =
      invitation !== null && (invitation.acceptedAt !== null || invitation.revokedAt !== null);
    if (!invitation || expired || spent) {
      return yield* authError(
        404,
        "INVITATION_NOT_FOUND",
        "This invitation is no longer valid. Ask for a new one.",
      );
    }
    if (invitation.email !== normalizeEmail(claims.email)) {
      return yield* authError(
        403,
        "INVITATION_EMAIL_MISMATCH",
        `This invitation was sent to ${invitation.email}.`,
      );
    }
    const accepted = yield* repository.acceptInvitation({
      invitation,
      userId: claims.subject,
      now,
    });
    if (!accepted) {
      return yield* authError(
        409,
        "INVITATION_ALREADY_USED",
        "This invitation has already been used.",
      );
    }
    yield* repository.moveSession({
      sessionId: claims.sessionId,
      organizationId: invitation.organizationId,
    });
    return {
      _tag: "Joined",
      organization: AuthOrganizationMembership.make({
        id: invitation.organizationId,
        name: invitation.organizationName,
        slug: invitation.organizationSlug,
        role: invitation.role,
      }),
    } as const;
  });

  const lastOwnerOrMissing = Effect.fn("Auth.Organization.lastOwnerOrMissing")(function* (
    organizationId: OrganizationId,
    userId: UserId,
    lastOwnerMessage: string,
  ) {
    const latest = yield* repository.membershipInOrganization({ userId, organizationId });
    if (latest?.role === "owner") {
      return yield* authError(409, "LAST_OWNER", lastOwnerMessage);
    }
    return yield* authError(404, "MEMBER_NOT_FOUND", "This person is not a member.");
  });

  const changeMemberRole = Effect.fn("Auth.Organization.changeMemberRole")(function* (
    claims: AccessClaims,
    input: {
      readonly organizationId: OrganizationId;
      readonly userId: UserId;
      readonly role: OrganizationRole;
    },
  ) {
    yield* requireRole(claims.subject, input.organizationId, ["owner"]);
    const target = yield* repository.membershipInOrganization({
      userId: input.userId,
      organizationId: input.organizationId,
    });
    if (!target) {
      return yield* authError(404, "MEMBER_NOT_FOUND", "This person is not a member.");
    }
    if (target.role === input.role) return { _tag: "Applied" } as const;
    const changed = yield* repository.changeMemberRole(input);
    if (!changed) {
      const latest = yield* repository.membershipInOrganization({
        userId: input.userId,
        organizationId: input.organizationId,
      });
      if (latest?.role === input.role) return { _tag: "Applied" } as const;
      return yield* lastOwnerOrMissing(
        input.organizationId,
        input.userId,
        "Make someone else an owner before changing this role.",
      );
    }
    return { _tag: "Applied" } as const;
  });

  const removeMember = Effect.fn("Auth.Organization.removeMember")(function* (
    claims: AccessClaims,
    input: {
      readonly organizationId: OrganizationId;
      readonly userId: UserId;
    },
  ) {
    const caller = yield* requireRole(claims.subject, input.organizationId, ["owner", "admin"]);
    if (input.userId === claims.subject) {
      return yield* authError(
        409,
        "CANNOT_REMOVE_SELF",
        "Leave the organization instead of removing yourself.",
      );
    }
    const target = yield* repository.membershipInOrganization({
      userId: input.userId,
      organizationId: input.organizationId,
    });
    if (!target) {
      return yield* authError(404, "MEMBER_NOT_FOUND", "This person is not a member.");
    }
    if (caller.role === "admin" && target.role !== "member") {
      return yield* authError(
        403,
        "INSUFFICIENT_ROLE",
        "Only the organization owner can remove an owner or an admin.",
      );
    }
    const removed = yield* repository.removeMember(input);
    if (!removed) {
      return yield* lastOwnerOrMissing(
        input.organizationId,
        input.userId,
        "Make someone else an owner before removing this person.",
      );
    }
    return { _tag: "Applied" } as const;
  });

  const organize = Effect.fn("Auth.Organization.organize")(function* (input: {
    readonly accessToken: string;
    readonly command: OrganizationCommand;
  }) {
    const now = yield* Clock.currentTimeMillis;
    const claims = yield* sessions.authorize(input.accessToken);
    const command = input.command;
    switch (command._tag) {
      case "UpdateOrganization":
        return yield* updateOrganization(claims, command);
      case "InviteMember":
        return yield* inviteMember(claims, command);
      case "RevokeInvitation": {
        yield* requireRole(claims.subject, command.organizationId, ["owner", "admin"]);
        const revoked = yield* repository.revokeInvitation({
          organizationId: command.organizationId,
          invitationId: command.invitationId,
          now,
        });
        if (!revoked) {
          return yield* authError(
            404,
            "INVITATION_NOT_FOUND",
            "This invitation is no longer pending.",
          );
        }
        return { _tag: "Applied" } as const;
      }
      case "AcceptInvitation":
        return yield* acceptInvitation(claims, command.token);
      case "ChangeMemberRole":
        return yield* changeMemberRole(claims, command);
      case "RemoveMember":
        return yield* removeMember(claims, command);
      default: {
        const _exhaustive: never = command;
        return _exhaustive;
      }
    }
  });

  return { roster, organize };
};

export type OrganizationOps = ReturnType<typeof makeOrganizationOps>;
