import {
  normalizedEmail,
  type EmailAddress,
  type OrganizationRole,
  type UserId,
} from "@store/auth";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import { AuthRefusal, InvitationEmailMismatch } from "./failures";
import type { InvitationRecord, MembershipRecord } from "./repository";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

const ROLE_RANK = { member: 0, admin: 1, owner: 2 } as const satisfies Record<
  OrganizationRole,
  number
>;

const MANAGERS: ReadonlyArray<OrganizationRole> = ["owner", "admin"];
const OWNERS: ReadonlyArray<OrganizationRole> = ["owner"];

export type RoleRequirement = "owner" | "manager";

export const isDemotion = (from: OrganizationRole, to: OrganizationRole) =>
  ROLE_RANK[to] < ROLE_RANK[from];

export const defaultOrganizationName = (ownerName: string) => `${ownerName.trim() || "My"}'s Shop`;

export const requireRole = (
  membership: MembershipRecord,
  requirement: RoleRequirement,
): Result.Result<MembershipRecord, AuthRefusal> =>
  (requirement === "owner" ? OWNERS : MANAGERS).includes(membership.role)
    ? Result.succeed(membership)
    : Result.fail(new AuthRefusal({ reason: `InsufficientRole.${requirement}` }));

export const refuseSelfRemoval = (callerId: UserId, targetId: UserId) =>
  callerId === targetId
    ? Result.fail(new AuthRefusal({ reason: "CannotRemoveSelf" }))
    : Result.succeed(targetId);

export const decideRemoval = (
  caller: MembershipRecord,
  target: Option.Option<MembershipRecord>,
): Result.Result<MembershipRecord, AuthRefusal> => {
  if (Option.isNone(target)) return Result.fail(new AuthRefusal({ reason: "MemberNotFound" }));
  if (caller.role === "admin" && target.value.role !== "member") {
    return Result.fail(new AuthRefusal({ reason: "InsufficientRole.ownerOverManagers" }));
  }
  return Result.succeed(target.value);
};

export const decideInvitationAcceptance = (
  invitation: Option.Option<InvitationRecord>,
  acceptingEmail: EmailAddress,
  now: number,
): Result.Result<InvitationRecord, AuthRefusal | InvitationEmailMismatch> => {
  if (
    Option.isNone(invitation) ||
    invitation.value.expiresAt <= now ||
    invitation.value.acceptedAt !== null ||
    invitation.value.revokedAt !== null
  ) {
    return Result.fail(new AuthRefusal({ reason: "InvitationInvalid" }));
  }
  if (invitation.value.email !== normalizedEmail(acceptingEmail)) {
    return Result.fail(new InvitationEmailMismatch({ invited: invitation.value.email }));
  }
  return Result.succeed(invitation.value);
};
