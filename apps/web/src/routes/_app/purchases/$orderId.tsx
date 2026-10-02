import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { PurchaseOrderError, PurchaseOrderPage } from "@/components/purchases/order-page";
import { formValidator } from "@/lib/form-schema";
import {
  preloadInventory,
  preloadPurchaseOrder,
  useSuspensePurchaseOrder,
  useSuspensePurchaseOrderDeliveries,
  useSuspenseSuppliers,
} from "@/lib/inventory";
import { lenientSearchParam } from "@/lib/search-param";

const orderSearch = formValidator(Schema.Struct({ receive: lenientSearchParam(Schema.Boolean) }));

export const Route = createFileRoute("/_app/purchases/$orderId")({
  validateSearch: orderSearch,
  loader: ({ context, params }) =>
    preloadInventory(context, (inventory) => preloadPurchaseOrder(inventory, params.orderId)),
  component: PurchaseOrderRoute,
  errorComponent: PurchaseOrderError,
  staticData: { breadcrumb: "Order" },
});

function PurchaseOrderRoute() {
  const { orderId } = Route.useParams();
  const { receive = false } = Route.useSearch();
  const navigate = Route.useNavigate();
  const order = useSuspensePurchaseOrder(orderId);
  const deliveries = useSuspensePurchaseOrderDeliveries(orderId);
  const suppliers = useSuspenseSuppliers();
  if (!order) throw new Error(`Purchase order ${orderId} was not found.`);
  return (
    <PurchaseOrderPage
      deliveries={deliveries}
      onReceiveOpenChange={(open) =>
        void navigate({ search: open ? { receive: true } : {}, replace: true })
      }
      order={order}
      receiveOpen={receive}
      supplier={suppliers.find((supplier) => supplier.id === order.supplierId)}
    />
  );
}
