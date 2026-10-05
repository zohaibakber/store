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
  setupRequired: {},
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
      return true;
    case "setupRequired":
    case "locked":
      return false;
    case "unlocked":
      return roleAllows(state.actor.role, permission);
  }
};

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
