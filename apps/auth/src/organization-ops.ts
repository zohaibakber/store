import {
  EmailAddress,
  EmailProvider,
  InvitationToken,
  normalizeEmail,
  OrganizationInvitation,
  OrganizationRoster,
  type AccessClaims,
  type AuthOrganizationMembership,
  type OrganizationCommand,
  type OrganizationId,
  type OrganizationRole,
  type UserId,
} from "@store/auth";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { AuthCrypto, INVITATION_TTL_MS } from "./crypto";
import { AuthRefusal, InvitationEmailMismatch } from "./failures";
import { HubRevocation } from "./hub-revocation";
import { AuthLimiter } from "./limits";
import { AuthRepository, type InvitationRecord, type MembershipRecord } from "./repository";
import { Sessions } from "./session-ops";
import { AuthSettings } from "./settings";

const ROLE_RANK = { member: 0, admin: 1, owner: 2 } as const satisfies Record<
  OrganizationRole,
  number
>;

const isDemotion = (from: OrganizationRole, to: OrganizationRole) =>
  ROLE_RANK[to] < ROLE_RANK[from];

const MANAGERS: ReadonlyArray<OrganizationRole> = ["owner", "admin"];
const OWNERS: ReadonlyArray<OrganizationRole> = ["owner"];

export class Organizations extends Context.Service<Organizations>()(
  "@store/auth-worker/Organizations",
  {
    make: Effect.gen(function* () {
      const repository = yield* AuthRepository;
      const email = yield* EmailProvider;
      const sessions = yield* Sessions;
      const limiter = yield* AuthLimiter;
      const hubs = yield* HubRevocation;
      const crypto = yield* AuthCrypto;
      const { refreshTokenPepper } = yield* AuthSettings;

      const hashInvite = (secret: Redacted.Redacted<string>) =>
        crypto.invitationHash(refreshTokenPepper, secret);

      const membershipOf = Effect.fn("Auth.Organization.membershipOf")(function* (
        userId: UserId,
        organizationId: OrganizationId,
      ) {
        const membership = yield* repository.membershipInOrganization({ userId, organizationId });
        if (!membership) {
          return yield* new AuthRefusal({ reason: "OrganizationNotFound" });
        }
        return membership;
      });

      const requireRole = Effect.fn("Auth.Organization.requireRole")(function* (
        userId: UserId,
        organizationId: OrganizationId,
        requires: "owner" | "manager",
      ) {
        const membership = yield* membershipOf(userId, organizationId);
        if (!(requires === "owner" ? OWNERS : MANAGERS).includes(membership.role)) {
          return yield* new AuthRefusal({ reason: `InsufficientRole.${requires}` });
        }
        return membership;
      });

      const membershipView = (membership: MembershipRecord): AuthOrganizationMembership => ({
        id: membership.organizationId,
        name: membership.organizationName,
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

      const roster = Effect.fn("Auth.Organization.roster")(function* (
        accessToken: Redacted.Redacted<string>,
      ) {
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
        },
      ) {
        const membership = yield* requireRole(claims.subject, input.organizationId, "manager");
        const updated = yield* repository.updateOrganization({
          organizationId: input.organizationId,
          name: input.name,
          role: membership.role,
        });
        if (!updated) {
          return yield* new AuthRefusal({ reason: "OrganizationNotFound" });
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
        yield* requireRole(claims.subject, input.organizationId, "manager");
        const address = EmailAddress.make(normalizeEmail(input.email));
        const members = yield* repository.listMembers(input.organizationId);
        if (members.some((member) => member.email === address)) {
          return yield* new AuthRefusal({ reason: "AlreadyAMember" });
        }
        const secret = yield* crypto.randomSecret(32);
        const token = InvitationToken.make(Redacted.value(secret));
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
            token,
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
          token,
        } as const;
      });

      const acceptInvitation = Effect.fn("Auth.Organization.acceptInvitation")(function* (
        claims: AccessClaims,
        token: InvitationToken,
      ) {
        const now = yield* Clock.currentTimeMillis;
        yield* limiter.admit("tenPerMinute", `accept-invitation:${claims.subject}`, "invitation");
        const tokenHash = yield* hashInvite(Redacted.make(token));
        const invitation = yield* repository.findInvitationByTokenHash(tokenHash);
        const expired = invitation !== null && invitation.expiresAt <= now;
        const spent =
          invitation !== null && (invitation.acceptedAt !== null || invitation.revokedAt !== null);
        if (!invitation || expired || spent) {
          return yield* new AuthRefusal({ reason: "InvitationInvalid" });
        }
        if (invitation.email !== normalizeEmail(claims.email)) {
          return yield* new InvitationEmailMismatch({ invited: invitation.email });
        }
        const accepted = yield* repository.acceptInvitation({
          invitation,
          userId: claims.subject,
          sessionId: claims.sessionId,
          now,
        });
        if (!accepted) {
          return yield* new AuthRefusal({ reason: "InvitationAlreadyUsed" });
        }
        return {
          _tag: "Joined",
          organization: membershipView(invitation),
        } as const;
      });

      const lastOwnerOrMissing = Effect.fn("Auth.Organization.lastOwnerOrMissing")(function* (
        organizationId: OrganizationId,
        userId: UserId,
        blocks: "roleChange" | "removal",
      ) {
        const latest = yield* repository.membershipInOrganization({ userId, organizationId });
        if (latest?.role === "owner") {
          return yield* new AuthRefusal({ reason: `LastOwner.${blocks}` });
        }
        return yield* new AuthRefusal({ reason: "MemberNotFound" });
      });

      const changeMemberRole = Effect.fn("Auth.Organization.changeMemberRole")(function* (
        claims: AccessClaims,
        input: {
          readonly organizationId: OrganizationId;
          readonly userId: UserId;
          readonly role: OrganizationRole;
        },
      ) {
        yield* requireRole(claims.subject, input.organizationId, "owner");
        const target = yield* repository.membershipInOrganization({
          userId: input.userId,
          organizationId: input.organizationId,
        });
        if (!target) {
          return yield* new AuthRefusal({ reason: "MemberNotFound" });
        }
        if (target.role === input.role) return { _tag: "Applied" } as const;
        const changed = yield* repository.changeMemberRole(input);
        if (!changed) {
          const latest = yield* repository.membershipInOrganization({
            userId: input.userId,
            organizationId: input.organizationId,
          });
          if (latest?.role === input.role) return { _tag: "Applied" } as const;
          return yield* lastOwnerOrMissing(input.organizationId, input.userId, "roleChange");
        }
        if (isDemotion(target.role, input.role)) {
          yield* hubs.revoke(input.organizationId, input.userId);
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
        const caller = yield* requireRole(claims.subject, input.organizationId, "manager");
        if (input.userId === claims.subject) {
          return yield* new AuthRefusal({ reason: "CannotRemoveSelf" });
        }
        const target = yield* repository.membershipInOrganization({
          userId: input.userId,
          organizationId: input.organizationId,
        });
        if (!target) {
          return yield* new AuthRefusal({ reason: "MemberNotFound" });
        }
        if (caller.role === "admin" && target.role !== "member") {
          return yield* new AuthRefusal({ reason: "InsufficientRole.ownerOverManagers" });
        }
        const removed = yield* repository.removeMember(input);
        if (!removed) {
          return yield* lastOwnerOrMissing(input.organizationId, input.userId, "removal");
        }
        yield* hubs.revoke(input.organizationId, input.userId);
        return { _tag: "Applied" } as const;
      });

      const organize = Effect.fn("Auth.Organization.organize")(function* (input: {
        readonly accessToken: Redacted.Redacted<string>;
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
            yield* requireRole(claims.subject, command.organizationId, "manager");
            const revoked = yield* repository.revokeInvitation({
              organizationId: command.organizationId,
              invitationId: command.invitationId,
              now,
            });
            if (!revoked) {
              return yield* new AuthRefusal({ reason: "InvitationNotPending" });
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
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
