import { useAtomValue } from "@effect/atom-react";
import {
  permits,
  type AssignableStaffRole,
  type InvoiceId,
  type InvoiceStaff,
  type StaffId,
  type StaffPermission,
  type StaffRole,
  type StaffState,
} from "@store/contracts";
import type { StaffFailure } from "@store/contracts/replica";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as Redacted from "effect/Redacted";
import type { RpcClientError } from "effect/rpc/RpcClientError";

import { useCatalogReplica } from "./provider";
import type { InventoryLinks, StoreClient } from "./services";

export const makeStaffCommands = (links: InventoryLinks) => {
  const staff =
    <I>() =>
    <A>(send: (store: StoreClient, input: I) => Effect.Effect<A, StaffFailure | RpcClientError>) =>
      Atom.fn<I>()((input, get) =>
        links.command(get.registry, (store) => Effect.suspend(() => send(store, input))),
      );

  return {
    setUpOwner: staff<{ readonly name: string; readonly pin: Redacted.Redacted }>()(
      (store, input) => store("SetUpOwner", input),
    ),
    unlock: staff<{ readonly staffId: StaffId; readonly pin: Redacted.Redacted }>()(
      (store, input) => store("Unlock", input),
    ),
    lock: staff<void>()((store) => store("Lock", undefined)),
    add: staff<{
      readonly name: string;
      readonly role: AssignableStaffRole;
      readonly pin: Redacted.Redacted;
    }>()((store, input) => store("AddStaff", input)),
    update: staff<{
      readonly id: StaffId;
      readonly name: string;
      readonly role: StaffRole;
      readonly pin?: Redacted.Redacted;
    }>()((store, input) => store("UpdateStaff", input)),
    remove: staff<StaffId>()((store, id) => store("RemoveStaff", { id })),
    recoverOwner: staff<{
      readonly recoveryCode: Redacted.Redacted;
      readonly pin: Redacted.Redacted;
    }>()((store, input) => store("RecoverOwner", input)),
    renewRecoveryCode: staff<void>()((store) => store("RenewRecoveryCode", undefined)),
    setAutoLock: staff<number>()((store, minutes) => store("SetAutoLock", { minutes })),
    events: staff<void>()((store) => store("StaffEvents", undefined)),
    turnOff: staff<void>()((store) => store("TurnOffStaff", undefined)),
    handOverDraft: staff<{ readonly draftId: InvoiceId; readonly from: StaffId }>()(
      (store, input) => store("HandOverDraft", input),
    ),
  };
};

export const useStaffState = (): StaffState | undefined =>
  Option.getOrUndefined(useAtomValue(useCatalogReplica().atoms.staff));

export const useStaffPermission = (permission: StaffPermission): boolean => {
  const state = useStaffState();
  return state !== undefined && permits(state, permission);
};

const NO_INVOICE_STAFF: InvoiceStaff = { soldBy: null, startedBy: null };

export const useInvoiceStaff = (invoiceId: InvoiceId): InvoiceStaff =>
  AsyncResult.getOrElse(
    useAtomValue(useCatalogReplica().atoms.invoiceStaff(invoiceId)),
    () => NO_INVOICE_STAFF,
  );
