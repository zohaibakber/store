import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { InvoiceId, StaffId } from "../ids";
import {
  AssignableStaffRole,
  AutoLockMinutes,
  MAX_STAFF_EVENTS,
  StaffEvent,
  StaffMember,
  StaffName,
  StaffPin,
  StaffRefusal,
  StaffRole,
  StaffState,
} from "../staff";
import { ReadFailure, ReplicaStorageError, ReplicaUnavailable } from "./errors";

export const StaffFailure = Schema.Union([ReplicaStorageError, ReplicaUnavailable, StaffRefusal]);
export type StaffFailure = typeof StaffFailure.Type;

const SubmittedPin = Schema.RedactedFromValue(StaffPin);

const SubmittedRecoveryCode = Schema.RedactedFromValue(Schema.String.check(Schema.isMaxLength(64)));

export const IssuedRecoveryCode = Schema.Struct({ recoveryCode: Schema.String });
export type IssuedRecoveryCode = typeof IssuedRecoveryCode.Type;

export class StaffRpcs extends RpcGroup.make(
  Rpc.make("StaffState", { success: StaffState, error: ReadFailure, stream: true }),
  Rpc.make("SetUpOwner", {
    payload: { name: StaffName, pin: SubmittedPin },
    success: IssuedRecoveryCode,
    error: StaffFailure,
  }),
  Rpc.make("Unlock", {
    payload: { staffId: StaffId, pin: SubmittedPin },
    success: StaffMember,
    error: StaffFailure,
  }),
  Rpc.make("Lock"),
  Rpc.make("AddStaff", {
    payload: { name: StaffName, role: AssignableStaffRole, pin: SubmittedPin },
    success: StaffMember,
    error: StaffFailure,
  }),
  Rpc.make("UpdateStaff", {
    payload: {
      id: StaffId,
      name: StaffName,
      role: StaffRole,
      pin: Schema.optionalKey(SubmittedPin),
    },
    success: StaffMember,
    error: StaffFailure,
  }),
  Rpc.make("RemoveStaff", { payload: { id: StaffId }, error: StaffFailure }),
  Rpc.make("RecoverOwner", {
    payload: { recoveryCode: SubmittedRecoveryCode, pin: SubmittedPin },
    success: IssuedRecoveryCode,
    error: StaffFailure,
  }),
  Rpc.make("RenewRecoveryCode", { success: IssuedRecoveryCode, error: StaffFailure }),
  Rpc.make("SetAutoLock", { payload: { minutes: AutoLockMinutes }, error: StaffFailure }),
  Rpc.make("StaffEvents", {
    success: Schema.Array(StaffEvent).check(Schema.isMaxLength(MAX_STAFF_EVENTS)),
    error: StaffFailure,
  }),
  Rpc.make("HandOverDraft", {
    payload: { draftId: InvoiceId, from: StaffId },
    error: StaffFailure,
  }),
) {}
