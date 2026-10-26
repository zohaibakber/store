import { decodePurchaseOrderId, decodeSupplierId } from "@store/contracts/ids";
import {
  ReceiveDeliveryInput,
  SaveOrderDraftInput,
  SaveSupplierInput,
  type CommandFailure,
  type Commit,
} from "@store/contracts/replica";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberHandle from "effect/FiberHandle";
import * as Option from "effect/Option";
import type * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import { createWorkspaceAtoms, type WorkspaceAtoms } from "./atoms";
import type { CatalogCommands } from "./catalog-commands";
import {
  CatalogOpenFailure,
  causeSurface,
  InventoryCommandError,
  staleCatalogLease,
  type StaleCatalogLease,
} from "./errors";
import {
  replicaAuthorityOf,
  type InventoryHost,
  type InventoryScope,
  type OpenedReplica,
  type ReplicaAuthority,
} from "./host";
import { makeInventoryLinks, type InventoryLinks, type StoreClient } from "./services";
import { makeStaffActions } from "./staff";
import type { Inventory, InventoryActions } from "./types";

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

export type CatalogLease = {
  readonly scope: InventoryScope;
};

export type CatalogLifetime = {
  readonly lease: () => CatalogLease | null;
  readonly claim: (scope: InventoryScope) => CatalogLease;
  readonly release: () => void;
  readonly open: (
    lease: CatalogLease,
    host: InventoryHost,
  ) => Effect.Effect<Inventory, StaleCatalogLease | CatalogOpenFailure>;
};

type Tenancy = {
  readonly lease: CatalogLease;
  readonly scope: Scope.Closeable;
  readonly opened: Deferred.Deferred<Inventory>;
  readonly opening: FiberHandle.FiberHandle<Inventory, CatalogOpenFailure>;
};

const makeTenancy = Effect.fn("CatalogLifetime.makeTenancy")(function* (
  root: Scope.Scope,
  scope: InventoryScope,
) {
  const leaseScope = yield* Scope.fork(root);
  const opening = yield* FiberHandle.make<Inventory, CatalogOpenFailure>().pipe(
    Scope.provide(leaseScope),
  );
  const opened = yield* Deferred.make<Inventory>();
  const tenancy: Tenancy = { lease: { scope }, scope: leaseScope, opened, opening };
  return tenancy;
});

export const createAppCatalogLifetime = (registry: AtomRegistry.AtomRegistry): CatalogLifetime => {
  const root = Scope.makeUnsafe();
  let current: Tenancy | null = null;

  const acquire = Effect.fn("CatalogLifetime.acquire")(function* (
    tenancy: Tenancy,
    host: InventoryHost,
  ) {
    const attempt = yield* Scope.fork(tenancy.scope);
    const close = () => Effect.runPromise(Scope.close(attempt, Exit.void));
    const workspace = yield* openWorkspace(registry, host, tenancy.lease.scope).pipe(
      Scope.provide(attempt),
      Effect.onError(() => Scope.close(attempt, Exit.void)),
    );
    const inventory: Inventory = { ...workspace, dispose: close };
    yield* Deferred.succeed(tenancy.opened, inventory);
    return inventory;
  });

  const joinOpening = Effect.fn("CatalogLifetime.joinOpening")(function* (
    tenancy: Tenancy,
    host: InventoryHost,
  ) {
    const running = yield* FiberHandle.get(tenancy.opening);
    const fiber = Option.isSome(running)
      ? running.value
      : yield* FiberHandle.run(tenancy.opening, acquire(tenancy, host));
    const exit = yield* Fiber.await(fiber);
    if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) {
      return yield* staleCatalogLease();
    }
    return yield* exit;
  });

  const retire = () => {
    const previous = current;
    current = null;
    if (previous !== null) Effect.runFork(Scope.close(previous.scope, Exit.void));
  };

  return {
    lease: () => current?.lease ?? null,
    claim: (scope) => {
      retire();
      const tenancy = Effect.runSync(makeTenancy(root, scope));
      current = tenancy;
      return tenancy.lease;
    },
    release: retire,
    open: (lease, host) =>
      Effect.suspend(() => {
        const tenancy = current;
        if (tenancy === null || tenancy.lease !== lease) return Effect.fail(staleCatalogLease());
        return Deferred.isDoneUnsafe(tenancy.opened)
          ? Deferred.await(tenancy.opened)
          : joinOpening(tenancy, host);
      }),
  };
};
