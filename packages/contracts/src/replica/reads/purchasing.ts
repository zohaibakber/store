import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { ProductId, PurchaseOrderId, SupplierId } from "../../ids";
import { PurchaseOrder, StockMovement, Supplier } from "../../store/schema";
import { PurchaseOrderItemRow, PurchaseOrderRow } from "../../sync/entity-rows";
import { ReadFailure } from "../errors";
import { PageSize, PurchaseOrderListFilters, PurchaseOrderListRequest } from "../list-request";
import { Stamp } from "../notices";
import { Count, IdList } from "./shared";

export const LearnedSupplier = Schema.Struct({ productId: ProductId, supplierId: SupplierId });
export type LearnedSupplier = typeof LearnedSupplier.Type;

export class PurchasingReads extends RpcGroup.make(
  Rpc.make("PurchaseOrderPage", {
    payload: PurchaseOrderListRequest,
    success: Schema.Struct({ stamp: Stamp, orders: Schema.Array(PurchaseOrder) }),
    error: ReadFailure,
  }),
  Rpc.make("PurchaseOrderCount", {
    payload: { filters: PurchaseOrderListFilters },
    success: Count,
    error: ReadFailure,
  }),
  Rpc.make("OpenPurchaseOrders", {
    payload: { limit: PageSize },
    success: Schema.Struct({ stamp: Stamp, orders: Schema.Array(PurchaseOrder) }),
    error: ReadFailure,
  }),
  Rpc.make("PurchaseOrderDetail", {
    payload: { id: PurchaseOrderId },
    success: Schema.Struct({
      stamp: Stamp,
      order: Schema.NullOr(PurchaseOrder),
      deliveries: Schema.Array(StockMovement),
    }),
    error: ReadFailure,
  }),
  Rpc.make("OpenOrderLines", {
    payload: { productIds: IdList(ProductId) },
    success: Schema.Struct({
      stamp: Stamp,
      orders: Schema.Array(PurchaseOrderRow),
      lines: Schema.Array(PurchaseOrderItemRow),
    }),
    error: ReadFailure,
  }),
  Rpc.make("LearnedSupplierIds", {
    payload: { productIds: IdList(ProductId) },
    success: Schema.Struct({ stamp: Stamp, suppliers: Schema.Array(LearnedSupplier) }),
    error: ReadFailure,
  }),
  Rpc.make("Suppliers", {
    success: Schema.Struct({ stamp: Stamp, suppliers: Schema.Array(Supplier) }),
    error: ReadFailure,
  }),
  Rpc.make("SupplierCount", { success: Count, error: ReadFailure }),
) {}
