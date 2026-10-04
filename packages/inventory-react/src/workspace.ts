import type { CatalogCommands } from "@store/client-db";
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
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import { createWorkspaceAtoms, type WorkspaceAtoms } from "./atoms";
import {
  catalogOpenFailure,
  causeSurface,
  InventoryCommandError,
  staleCatalogLease,
  type CatalogOpenFailure,
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
    const attempt = crypto.randomUUID();
    registry.set(atoms.commandExecution, { _tag: "accepting", operationId: attempt });
    const exit = await Effect.runPromiseExit(
      links.command(registry, (store) => Effect.suspend(() => send(store))),
    );
    if (Exit.isFailure(exit)) {
      const surface = causeSurface(exit.cause);
      if (surface._tag === "storageFull") registry.set(atoms.storageFull, true);
      registry.set(atoms.commandExecution, {
        _tag: "failed",
        operationId: attempt,
        message: surface.message,
      });
      throw new InventoryCommandError(surface);
    }
    registry.set(atoms.storageFull, false);
    registry.set(atoms.commandExecution, {
      _tag: "pending",
      operationId: exit.value.operationId,
      status: exit.value.status,
    });
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
    retrySync: async () => {
      await Effect.runPromise(opened.retryRecovery);
      wake();
    },
    syncNow: wake,
  };
};

const openWorkspace = (host: InventoryHost, scope: InventoryScope) =>
  Effect.gen(function* () {
    const registry = yield* Effect.acquireRelease(
      Effect.sync(() => AtomRegistry.make()),
      (made) => Effect.sync(() => made.dispose()),
    );
    const opened = yield* host.open(
      { organizationId: scope.organizationId, userId: scope.userId, replicaId: host.deviceId },
      registry,
    );
    const links = makeInventoryLinks(host.services);
    const atoms = createWorkspaceAtoms(host.services, links, registry);
    yield* AtomRegistry.mount(registry, host.services.Reads.runtime);
    yield* AtomRegistry.mount(registry, links.commits);
    yield* AtomRegistry.mount(registry, links.insightChanges);
    yield* AtomRegistry.getResult(registry, atoms.syncSnapshot).pipe(
      Effect.timeout(FIRST_READ_WAIT),
      Effect.mapError(() => catalogOpenFailure(undefined)),
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

const makeTenancy = (root: Scope.Scope, scope: InventoryScope) =>
  Effect.gen(function* () {
    const leaseScope = yield* Scope.fork(root);
    const opening = yield* FiberHandle.make<Inventory, CatalogOpenFailure>().pipe(
      Scope.provide(leaseScope),
    );
    const opened = yield* Deferred.make<Inventory>();
    const tenancy: Tenancy = { lease: { scope }, scope: leaseScope, opened, opening };
    return tenancy;
  });

export const createAppCatalogLifetime = (): CatalogLifetime => {
  const root = Scope.makeUnsafe();
  let current: Tenancy | null = null;

  const acquire = (tenancy: Tenancy, host: InventoryHost) =>
    Effect.gen(function* () {
      const attempt = yield* Scope.fork(tenancy.scope);
      const close = () => Effect.runPromise(Scope.close(attempt, Exit.void));
      const workspace = yield* openWorkspace(host, tenancy.lease.scope).pipe(
        Scope.provide(attempt),
        Effect.onError(() => Scope.close(attempt, Exit.void)),
      );
      const inventory: Inventory = { ...workspace, dispose: close };
      yield* Deferred.succeed(tenancy.opened, inventory);
      return inventory;
    });

  const joinOpening = (tenancy: Tenancy, host: InventoryHost) =>
    Effect.gen(function* () {
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
