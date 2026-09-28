import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { InvoiceCreatePage } from "@/components/invoices/create-page";
import { formValidator } from "@/lib/form-schema";
import { lenientSearchParam } from "@/lib/search-param";

const newInvoiceSearch = formValidator(
  Schema.Struct({ add: lenientSearchParam(Schema.NonEmptyString) }),
);

export const Route = createFileRoute("/invoices/new")({
  validateSearch: newInvoiceSearch,
  component: NewInvoiceRoute,
  staticData: { breadcrumb: "New sale" },
});

function NewInvoiceRoute() {
  const { add } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <InvoiceCreatePage
      addProductId={add}
      onProductAdded={() => void navigate({ search: {}, replace: true })}
    />
  );
}
