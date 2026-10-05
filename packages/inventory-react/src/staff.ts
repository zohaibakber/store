import { useAtomValue } from "@effect/atom-react";
import {
  permits,
  type AssignableStaffRole,
  type InvoiceId,
  type InvoiceStaff,
  type StaffEvent,
  type StaffId,
  type StaffMember,
  type StaffPermission,
  type StaffRole,
  type StaffState,
} from "@store/contracts";
import type { StaffFailure } from "@store/contracts/replica";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Redacted from "effect/Redacted";
import type { RpcClientError } from "effect/rpc/RpcClientError";

import { causeSurface, InventoryCommandError } from "./errors";
import { useCatalogReplica, useInventoryActions } from "./provider";
import type { InventoryLinks, StoreClient } from "./services";

export type StaffActions = {
  readonly setUpOwner: (owner: {
    readonly name: string;
    readonly pin: string;
  }) => Promise<{ readonly recoveryCode: string }>;
  readonly unlock: (staffId: StaffId, pin: string) => Promise<StaffMember>;
  readonly lock: () => Promise<void>;
  readonly add: (member: {
    readonly name: string;
    readonly role: AssignableStaffRole;
    readonly pin: string;
  }) => Promise<StaffMember>;
  readonly update: (change: {
    readonly id: StaffId;
    readonly name: string;
    readonly role: StaffRole;
    readonly pin?: string;
  }) => Promise<StaffMember>;
  readonly remove: (id: StaffId) => Promise<void>;
  readonly recoverOwner: (
    recoveryCode: string,
    pin: string,
  ) => Promise<{ readonly recoveryCode: string }>;
  readonly renewRecoveryCode: () => Promise<{ readonly recoveryCode: string }>;
  readonly setAutoLock: (minutes: number) => Promise<void>;
  readonly events: () => Promise<ReadonlyArray<StaffEvent>>;
  readonly handOverDraft: (draftId: InvoiceId, from: StaffId) => Promise<void>;
};

export const makeStaffActions = (
  registry: AtomRegistry.AtomRegistry,
  links: InventoryLinks,
): StaffActions => {
  const request = async <A>(
    send: (store: StoreClient) => Effect.Effect<A, StaffFailure | RpcClientError>,
  ): Promise<A> => {
    const exit = await Effect.runPromiseExit(
      links.command(registry, (store) => Effect.suspend(() => send(store))),
    );
    if (Exit.isFailure(exit)) throw new InventoryCommandError(causeSurface(exit.cause));
    return exit.value;
  };

  return {
    setUpOwner: ({ name, pin }) =>
      request((store) => store("SetUpOwner", { name, pin: Redacted.make(pin) })),
    unlock: (staffId, pin) =>
      request((store) => store("Unlock", { staffId, pin: Redacted.make(pin) })),
    lock: () => request((store) => store("Lock", undefined)),
    add: ({ name, role, pin }) =>
      request((store) => store("AddStaff", { name, role, pin: Redacted.make(pin) })),
    update: ({ id, name, role, pin }) =>
      request((store) =>
        store(
          "UpdateStaff",
          pin === undefined ? { id, name, role } : { id, name, role, pin: Redacted.make(pin) },
        ),
      ),
    remove: (id) => request((store) => store("RemoveStaff", { id })),
    recoverOwner: (recoveryCode, pin) =>
      request((store) =>
        store("RecoverOwner", {
          recoveryCode: Redacted.make(recoveryCode),
          pin: Redacted.make(pin),
        }),
      ),
    renewRecoveryCode: () => request((store) => store("RenewRecoveryCode", undefined)),
    setAutoLock: (minutes) => request((store) => store("SetAutoLock", { minutes })),
    events: () => request((store) => store("StaffEvents", undefined)),
    handOverDraft: (draftId, from) => request((store) => store("HandOverDraft", { draftId, from })),
  };
};

export const useStaffState = (): StaffState | undefined =>
  Option.getOrUndefined(useAtomValue(useCatalogReplica().atoms.staff));

export const useStaffActions = (): StaffActions => useInventoryActions().staff;

export const useStaffPermission = (permission: StaffPermission): boolean => {
  const state = useStaffState();
  return state !== undefined && permits(state, permission);
};

const NO_INVOICE_STAFF: InvoiceStaff = { soldBy: null, startedBy: null };

export const useInvoiceStaff = (invoiceId: string): InvoiceStaff =>
  AsyncResult.getOrElse(
    useAtomValue(useCatalogReplica().atoms.invoiceStaff(invoiceId)),
    () => NO_INVOICE_STAFF,
  );
