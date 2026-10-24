import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { StaffId } from "./ids";

export const StaffRole = Schema.Literals(["owner", "manager", "cashier"]);
export type StaffRole = typeof StaffRole.Type;

export const AssignableStaffRole = Schema.Literals(["manager", "cashier"]);
export type AssignableStaffRole = typeof AssignableStaffRole.Type;

export const StaffPermission = Schema.Literals([
  "sell",
  "manageStock",
  "viewReports",
  "manageShop",
]);
export type StaffPermission = typeof StaffPermission.Type;

const RANK = { cashier: 0, manager: 1, owner: 2 } satisfies Record<StaffRole, number>;

const LOWEST_ROLE = {
  sell: "cashier",
  manageStock: "manager",
  viewReports: "manager",
  manageShop: "owner",
} satisfies Record<StaffPermission, StaffRole>;

export const roleAllows = (role: StaffRole, permission: StaffPermission): boolean =>
  RANK[role] >= RANK[LOWEST_ROLE[permission]];

export const MAX_STAFF_NAME_LENGTH = 40;

export const MAX_STAFF_MEMBERS = 50;

export const StaffName = Schema.Trimmed.check(Schema.isBetweenLength(1, MAX_STAFF_NAME_LENGTH));
export type StaffName = typeof StaffName.Type;

export const MIN_STAFF_PIN_LENGTH = 4;

export const MAX_STAFF_PIN_LENGTH = 6;

export const StaffPin = Schema.String.check(Schema.isPattern(/^\d{4,6}$/u));
export type StaffPin = typeof StaffPin.Type;

export const DEFAULT_AUTO_LOCK_MINUTES = 15;

export const MAX_AUTO_LOCK_MINUTES = 240;

export const AutoLockMinutes = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: MAX_AUTO_LOCK_MINUTES }),
);
export type AutoLockMinutes = typeof AutoLockMinutes.Type;

export const StaffMember = Schema.Struct({
  id: StaffId,
  name: Schema.String,
  role: StaffRole,
});
export type StaffMember = typeof StaffMember.Type;

export const StaffState = Schema.TaggedUnion({
  disabled: {},
  solo: {},
  locked: { staff: Schema.Array(StaffMember) },
  unlocked: {
    actor: StaffMember,
    staff: Schema.Array(StaffMember),
    autoLockMinutes: AutoLockMinutes,
  },
});
export type StaffState = typeof StaffState.Type;

export const permits = (state: StaffState, permission: StaffPermission): boolean => {
  switch (state._tag) {
    case "disabled":
    case "solo":
      return true;
    case "locked":
      return false;
    case "unlocked":
      return roleAllows(state.actor.role, permission);
  }
};

const namesMatch = (left: string, right: string) =>
  left.trim().toLowerCase() === right.trim().toLowerCase();

const refused = (reason: StaffRefusalReason) => Result.fail(new StaffRefusal({ reason }));

export const lockStaff = (state: StaffState): StaffState =>
  state._tag === "unlocked" ? { _tag: "locked", staff: state.staff } : state;

export const requireActor = (
  state: StaffState,
  permission: StaffPermission,
): Result.Result<StaffMember, StaffRefusal> => {
  switch (state._tag) {
    case "unlocked":
      return roleAllows(state.actor.role, permission)
        ? Result.succeed(state.actor)
        : refused("forbidden");
    case "disabled":
    case "solo":
    case "locked":
      return refused("locked");
  }
};

export const decideSetUpOwner = (hasActiveStaff: boolean): Result.Result<void, StaffRefusal> =>
  hasActiveStaff ? refused("alreadySetUp") : Result.succeed(undefined);

export const decideAddStaff = (
  active: ReadonlyArray<Pick<StaffMember, "name">>,
  name: string,
): Result.Result<void, StaffRefusal> => {
  if (active.length >= MAX_STAFF_MEMBERS) return refused("tooManyStaff");
  if (active.some((member) => namesMatch(member.name, name))) return refused("nameTaken");
  return Result.succeed(undefined);
};

export const decideUpdateStaff = (
  active: ReadonlyArray<StaffMember>,
  id: StaffId,
  name: string,
  role: StaffRole,
): Result.Result<StaffMember, StaffRefusal> => {
  const member = active.find((candidate) => candidate.id === id);
  if (member === undefined) return refused("unknownStaff");
  if ((member.role === "owner") !== (role === "owner")) return refused("ownerIsFixed");
  if (active.some((candidate) => candidate.id !== id && namesMatch(candidate.name, name))) {
    return refused("nameTaken");
  }
  return Result.succeed(member);
};

export const decideRemoveStaff = (
  member: StaffMember | undefined,
): Result.Result<StaffMember, StaffRefusal> => {
  if (member === undefined) return refused("unknownStaff");
  if (member.role === "owner") return refused("ownerIsFixed");
  return Result.succeed(member);
};

export const decideHandOverDraft = (
  rosterIds: ReadonlyArray<StaffId>,
  from: StaffId,
  actorId: StaffId,
): Result.Result<void, StaffRefusal> =>
  rosterIds.some((id) => id === from) && from !== actorId
    ? Result.succeed(undefined)
    : refused("unknownStaff");

export const StaffRefusalReason = Schema.Literals([
  "disabled",
  "locked",
  "forbidden",
  "wrongPin",
  "wrongRecoveryCode",
  "throttled",
  "alreadySetUp",
  "unknownStaff",
  "nameTaken",
  "ownerIsFixed",
  "tooManyStaff",
]);
export type StaffRefusalReason = typeof StaffRefusalReason.Type;

export class StaffRefusal extends Schema.TaggedError<StaffRefusal>()("StaffRefusal", {
  reason: StaffRefusalReason,
  retryAfterMillis: Schema.optionalKey(Schema.Number),
}) {}

export const StaffEventKind = Schema.Literals([
  "ownerSetUp",
  "staffAdded",
  "staffUpdated",
  "pinChanged",
  "staffRemoved",
  "ownerRecovered",
  "recoveryCodeRenewed",
  "autoLockChanged",
  "draftHandedOver",
  "unlockThrottled",
  "staffTurnedOff",
]);
export type StaffEventKind = typeof StaffEventKind.Type;

export const MAX_STAFF_EVENTS = 100;

export const StaffEvent = Schema.Struct({
  id: Schema.Number,
  at: Schema.Number,
  kind: StaffEventKind,
  actor: Schema.NullOr(Schema.String),
  subject: Schema.NullOr(Schema.String),
});
export type StaffEvent = typeof StaffEvent.Type;

export const InvoiceStaff = Schema.Struct({
  soldBy: Schema.NullOr(Schema.String),
  startedBy: Schema.NullOr(Schema.String),
});
export type InvoiceStaff = typeof InvoiceStaff.Type;
