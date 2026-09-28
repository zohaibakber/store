// @vitest-environment happy-dom
import { decodeCategoryId, decodeProductId } from "@store/contracts";
import { fireEvent, screen } from "@testing-library/react";
import * as React from "react";
import { expect, test } from "vitest";

import {
  DEFAULT_PRODUCT_LIST_VIEW,
  ProductTableFilters,
  useProductsTable,
  viewWithPagination,
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

const clickMenuItem = (item: HTMLElement) => {
  fireEvent.pointerDown(item, { pointerType: "mouse" });
  fireEvent.click(item, { detail: 1 });
};

const choose = async (filter: string, option: string) => {
  const trigger = screen.getByRole("button", { name: "Filter products" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const submenu = await screen.findByRole("menuitem", { name: filter });
  submenu.focus();
  fireEvent.keyDown(submenu, { key: "ArrowRight" });
  clickMenuItem(await screen.findByRole("menuitemradio", { name: option }));
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

  const trigger = screen.getByRole("button", { name: "Filter products" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  clickMenuItem(await screen.findByRole("menuitem", { name: "Clear filters" }));
  expect(views.at(-1)).toMatchObject({
    category: undefined,
    composition: undefined,
    aisle: undefined,
    strength: undefined,
  });
});

test("changing the page size returns to the first page", () => {
  const view = { ...DEFAULT_PRODUCT_LIST_VIEW, page: 4 };
  expect(viewWithPagination(view, { pageIndex: 5, pageSize: 50 })).toMatchObject({ page: 5 });
  expect(viewWithPagination(view, { pageIndex: 4, pageSize: 100 })).toMatchObject({
    page: 0,
    size: 100,
  });
});
