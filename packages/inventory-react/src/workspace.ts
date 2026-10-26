import { decodePurchaseOrderId, decodeSupplierId } from "@store/contracts/ids";
import {
  ReceiveDeliveryInput,
  SaveOrderDraftInput,
  SaveSupplierInput,
  type CommandFailure,
  type Commit,
} from "@store/contracts/replica";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import { createWorkspaceAtoms, type WorkspaceAtoms } from "./atoms";
import type { CatalogCommands } from "./catalog-commands";
import { CatalogOpenFailure, causeSurface, InventoryCommandError } from "./errors";
import {
  replicaAuthorityOf,
  type InventoryHost,
  type InventoryScope,
  type OpenedReplica,
  type ReplicaAuthority,
} from "./host";
import { makeInventoryLinks, type InventoryLinks, type StoreClient } from "./services";
import { makeStaffActions } from "./staff";
import type { InventoryActions } from "./types";

const FIRST_READ_WAIT = "20 seconds";

const decodeSupplier = Schema.decodeUnknownSync(SaveSupplierInput);
const decodeOrderDraft = Schema.decodeUnknownSync(SaveOrderDraftInput);
const decodeDelivery = Schema.decodeUnknownSync(ReceiveDeliveryInput);

const makeActions = (
  registry: AtomRegistry.AtomRegistry,
  links: InventoryLinks,
  atoms: WorkspaceAtoms,
  opened: OpenedReplica,
  authority: ReplicaAuthority,
): InventoryActions => {
  const dispatch = async <A extends Commit>(
    send: (store: StoreClient) => Effect.Effect<A, CommandFailure | RpcClientError>,
  ): Promise<A> => {
    const exit = await Effect.runPromiseExit(
      links.command(registry, (store) => Effect.suspend(() => send(store))),
    );
    if (Exit.isFailure(exit)) {
      const surface = causeSurface(exit.cause);
      if (surface._tag === "storageFull") registry.set(atoms.storageFull, true);
      throw new InventoryCommandError(surface);
    }
    registry.set(atoms.storageFull, false);
    return exit.value;
  };

  const wake = () => {
    if (authority === "remote") Effect.runFork(links.wake(registry));
  };

  const commands: CatalogCommands = {
    createCategory: async (input) =>
      (await dispatch((store) => store("CreateCategory", input))).result,
    updateCategory: async (input) =>
      (await dispatch((store) => store("UpdateCategory", input))).result,
    deleteCategory: async (id) => void (await dispatch((store) => store("DeleteCategory", { id }))),
    createProduct: async (input) =>
      (await dispatch((store) => store("CreateProduct", input))).result,
    createProductWithBatch: async (input) =>
      (await dispatch((store) => store("CreateProductWithBatch", input))).result,
    updateProduct: async (input) =>
      (await dispatch((store) => store("UpdateProduct", input))).result,
    deleteProduct: async (id) => void (await dispatch((store) => store("DeleteProduct", { id }))),
    createBatch: async (input) => (await dispatch((store) => store("CreateBatch", input))).result,
    receiveBatch: async (input) => (await dispatch((store) => store("ReceiveBatch", input))).result,
    updateBatch: async (input) => (await dispatch((store) => store("UpdateBatch", input))).result,
    importInventory: async (input) =>
      (await dispatch((store) => store("ImportInventory", input))).result,
    issueInvoice: async (input, invoiceId) =>
      (
        await dispatch((store) =>
          store("IssueInvoice", invoiceId === undefined ? { input } : { input, invoiceId }),
        )
      ).result,
    saveSupplier: async (input) =>
      (await dispatch((store) => store("SaveSupplier", decodeSupplier(input)))).result,
    deleteSupplier: async (id) =>
      void (await dispatch((store) => store("DeleteSupplier", { id: decodeSupplierId(id) }))),
    saveOrderDraft: async (input) =>
      (await dispatch((store) => store("SaveOrderDraft", decodeOrderDraft(input)))).result,
    sendOrder: async (id) =>
      (await dispatch((store) => store("SendOrder", { id: decodePurchaseOrderId(id) }))).result,
    closeOrder: async (id) =>
      (await dispatch((store) => store("CloseOrder", { id: decodePurchaseOrderId(id) }))).result,
    cancelOrder: async (id) =>
      (await dispatch((store) => store("CancelOrder", { id: decodePurchaseOrderId(id) }))).result,
    receiveDelivery: async (input) =>
      (await dispatch((store) => store("ReceiveDelivery", decodeDelivery(input)))).result,
  };

  return {
    ...commands,
    staff: makeStaffActions(registry, links),
    retrySync: async () => {
      await Effect.runPromise(opened.retryRecovery);
      wake();
    },
    syncNow: wake,
  };
};

const openWorkspace = Effect.fn("InventoryWorkspace.open")(function* (
  registry: AtomRegistry.AtomRegistry,
  host: InventoryHost,
  scope: InventoryScope,
) {
  const opened = yield* host.open(
    { organizationId: scope.organizationId, userId: scope.userId, replicaId: host.deviceId },
    registry,
  );
  const links = makeInventoryLinks(host.services);
  const atoms = createWorkspaceAtoms(host.services, links, registry);
  yield* Effect.forEach(
    [
      host.services.Reads.runtime,
      atoms.storageFull,
      atoms.syncSnapshot,
      ...links.retained,
    ] satisfies ReadonlyArray<Atom.Atom<unknown>>,
    (atom) => AtomRegistry.mount(registry, atom),
    { discard: true },
  );
  yield* AtomRegistry.getResult(registry, atoms.syncSnapshot).pipe(
    Effect.mapError(() => new CatalogOpenFailure({ reason: "firstReadFailed" })),
    Effect.timeoutOrElse({
      duration: FIRST_READ_WAIT,
      orElse: () => Effect.fail(new CatalogOpenFailure({ reason: "firstReadTimeout" })),
    }),
  );
  const authority = replicaAuthorityOf(scope);
  return {
    atoms,
    actions: makeActions(registry, links, atoms, opened, authority),
    authority,
    deviceId: opened.replicaId ?? host.deviceId,
  };
});

const openRetrySchedule = Schedule.exponential("200 millis").pipe(
  Schedule.jittered,
  Schedule.upTo({ times: 3 }),
);

const openAttempt = Effect.fn("InventoryWorkspace.openAttempt")(function* (
  host: InventoryHost,
  scope: InventoryScope,
) {
  const registry = yield* AtomRegistry.AtomRegistry;
  const attempt = yield* Scope.fork(yield* Effect.scope);
  return yield* openWorkspace(registry, host, scope).pipe(
    Scope.provide(attempt),
    Effect.onError(() => Scope.close(attempt, Exit.void)),
  );
});

export const openCatalog = (host: InventoryHost, scope: InventoryScope) =>
  openAttempt(host, scope).pipe(Effect.retry(openRetrySchedule));
