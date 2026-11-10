import type {
  CreateBatchInput,
  CreateCategoryInput,
  CreateInvoiceInput,
  CreateProductInput,
  InvoiceId,
  PurchaseOrderId,
  SupplierId,
  UpdateBatchInput,
  UpdateCategoryInput,
  UpdateProductInput,
} from "@store/contracts";
import {
  ReceiveDeliveryInput as ReceiveDeliverySchema,
  SaveOrderDraftInput as SaveOrderDraftSchema,
  SaveSupplierInput as SaveSupplierSchema,
  type CommandFailure,
  type ReceiveDeliveryLineInput as ReceiveDeliveryLineSchema,
} from "@store/contracts/replica";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import * as Schema from "effect/Schema";

import type { ReplicaAuthority, OpenedReplica } from "./host";
import type { InventoryLinks, StoreClient } from "./services";
import { makeStaffCommands } from "./staff";

type SaveSupplierInput = typeof SaveSupplierSchema.Encoded;
type SaveOrderDraftInput = typeof SaveOrderDraftSchema.Encoded;
type ReceiveDeliveryInput = typeof ReceiveDeliverySchema.Encoded;
export type ReceiveDeliveryLineInput = typeof ReceiveDeliveryLineSchema.Encoded;

type CommandError = CommandFailure | RpcClientError;

type IssueInvoiceCommand = {
  readonly input: CreateInvoiceInput;
  readonly invoiceId?: InvoiceId;
};

const result = <A>(commit: { readonly result: A }): A => commit.result;

export const makeWorkspaceCommands = (
  links: InventoryLinks,
  storageFull: Atom.Writable<boolean>,
  opened: OpenedReplica,
  authority: ReplicaAuthority,
) => {
  const command =
    <I>() =>
    <A>(send: (store: StoreClient, input: I) => Effect.Effect<A, CommandError>) =>
      Atom.fn<I>()((input, get) =>
        links
          .command(get.registry, (store) => Effect.suspend(() => send(store, input)))
          .pipe(
            Effect.tap(() => Effect.sync(() => get.set(storageFull, false))),
            Effect.tapError((failure) =>
              failure._tag === "ReplicaStorageError" && failure.full === true
                ? Effect.sync(() => get.set(storageFull, true))
                : Effect.void,
            ),
          ),
      );

  const decoded = <S extends Schema.Decoder<unknown>>(schema: S, input: S["Encoded"]) =>
    Schema.decodeUnknownEffect(schema)(input).pipe(Effect.orDie);

  const wake = (registry: Parameters<InventoryLinks["wake"]>[0]) =>
    authority === "remote" ? links.wake(registry) : Effect.void;

  return {
    createCategory: command<CreateCategoryInput>()((store, input) =>
      store("CreateCategory", input).pipe(Effect.map(result)),
    ),
    updateCategory: command<UpdateCategoryInput>()((store, input) =>
      store("UpdateCategory", input).pipe(Effect.map(result)),
    ),
    deleteCategory: command<UpdateCategoryInput["id"]>()((store, id) =>
      store("DeleteCategory", { id }).pipe(Effect.asVoid),
    ),
    createProduct: command<CreateProductInput>()((store, input) =>
      store("CreateProduct", input).pipe(Effect.map(result)),
    ),
    updateProduct: command<UpdateProductInput>()((store, input) =>
      store("UpdateProduct", input).pipe(Effect.map(result)),
    ),
    deleteProduct: command<UpdateProductInput["id"]>()((store, id) =>
      store("DeleteProduct", { id }).pipe(Effect.asVoid),
    ),
    createBatch: command<CreateBatchInput>()((store, input) =>
      store("CreateBatch", input).pipe(Effect.map(result)),
    ),
    updateBatch: command<UpdateBatchInput>()((store, input) =>
      store("UpdateBatch", input).pipe(Effect.map(result)),
    ),
    issueInvoice: command<IssueInvoiceCommand>()((store, payload) =>
      store("IssueInvoice", payload).pipe(Effect.map(result)),
    ),
    saveSupplier: command<SaveSupplierInput>()((store, input) =>
      decoded(SaveSupplierSchema, input).pipe(
        Effect.flatMap((supplier) => store("SaveSupplier", supplier)),
        Effect.map(result),
      ),
    ),
    deleteSupplier: command<SupplierId>()((store, id) =>
      store("DeleteSupplier", { id }).pipe(Effect.asVoid),
    ),
    saveOrderDraft: command<SaveOrderDraftInput>()((store, input) =>
      decoded(SaveOrderDraftSchema, input).pipe(
        Effect.flatMap((draft) => store("SaveOrderDraft", draft)),
        Effect.map(result),
      ),
    ),
    sendOrder: command<PurchaseOrderId>()((store, id) =>
      store("SendOrder", { id }).pipe(Effect.map(result)),
    ),
    closeOrder: command<PurchaseOrderId>()((store, id) =>
      store("CloseOrder", { id }).pipe(Effect.map(result)),
    ),
    cancelOrder: command<PurchaseOrderId>()((store, id) =>
      store("CancelOrder", { id }).pipe(Effect.map(result)),
    ),
    receiveDelivery: command<ReceiveDeliveryInput>()((store, input) =>
      decoded(ReceiveDeliverySchema, input).pipe(
        Effect.flatMap((delivery) => store("ReceiveDelivery", delivery)),
        Effect.map(result),
      ),
    ),
    staff: makeStaffCommands(links),
    retrySync: Atom.fn<void>()((_, get) =>
      opened.retryRecovery.pipe(Effect.andThen(wake(get.registry))),
    ),
  };
};

export type WorkspaceCommands = ReturnType<typeof makeWorkspaceCommands>;

export const commandAtoms = (commands: WorkspaceCommands): ReadonlyArray<Atom.Atom<unknown>> => {
  const { staff, ...catalog } = commands;
  return [...Object.values(catalog), ...Object.values(staff)];
};
