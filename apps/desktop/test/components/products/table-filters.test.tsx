// @vitest-environment happy-dom
import { decodeCategoryId, decodeProductId } from "@store/contracts";
import { fireEvent, screen } from "@testing-library/react";
import * as React from "react";
import { expect, test } from "vitest";

import {
  DEFAULT_PRODUCT_LIST_VIEW,
  ProductTableFilters,
  useProductsTable,
  type ProductListRow,
  type ProductListView,
} from "@/components/products/table";
import { DataTable, DataTableContent } from "@/components/shared/data-table";

import { renderWithRouter } from "../../lib/render";

const categories = [
  { id: "medicine", name: "Medicine" },
  { id: "personal-care", name: "Personal care" },
];

const facets = {
  categoryId: ["medicine", "personal-care"],
  name: ["Brufen", "Panadol"],
  aisle: ["A1", "A2", "B1"],
  composition: ["Ibuprofen", "Paracetamol"],
  strength: ["400mg", "500mg"],
};

const row: ProductListRow = {
  id: decodeProductId("panadol"),
  name: "Panadol",
  categoryId: decodeCategoryId("medicine"),
  categoryName: "Medicine",
  aisle: "A1",
  composition: "Paracetamol",
  strength: "500mg",
  unitsPerPack: 10,
  purchasePrice: 800,
  retailPrice: 1_000,
  unitPrice: 100,
  visible: true,
  organizationId: "org-1",
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: "device-1",
  operationId: "operation-1",
  rowVersion: 1,
  createdAt: Date.UTC(2026, 0, 1),
  updatedAt: Date.UTC(2026, 0, 1),
};

const views: Array<ProductListView> = [];

function ProductTableHarness() {
  const [view, setView] = React.useState<ProductListView>({
    ...DEFAULT_PRODUCT_LIST_VIEW,
    page: 3,
  });
  const table = useProductsTable({
    rows: [row],
    total: 1,
    view,
    categories,
    onViewChange: (next) => {
      views.push(next);
      setView(next);
    },
  });
  return (
    <DataTable table={table}>
      <ProductTableFilters categories={categories} facets={facets} />
      <DataTableContent />
    </DataTable>
  );
}

const openFilters = async () => {
  const trigger = screen.getByRole("button", { name: "Filter products" });
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  await screen.findByRole("button", { name: "Clear filters" });
};

const choose = async (filter: string, option: string) => {
  await openFilters();
  const input = screen.getByRole("combobox", { name: filter });
  input.focus();
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
};

test("product filters become a replica query view and clear together", async () => {
  renderWithRouter(<ProductTableHarness />);

  await choose("Category", "Medicine");
  await choose("Composition", "Paracetamol");
  await choose("Aisle", "A1");
  await choose("Strength", "500mg");
  expect(views.at(-1)).toMatchObject({
    category: "medicine",
    composition: "Paracetamol",
    aisle: "A1",
    strength: "500mg",
    page: 0,
  });

  await openFilters();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(views.at(-1)).toMatchObject({
    category: undefined,
    composition: undefined,
    aisle: undefined,
    strength: undefined,
  });
});
