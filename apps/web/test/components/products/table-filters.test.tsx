// @vitest-environment happy-dom
import type { Category, Product } from "@store/contracts";
import { decodeCategoryId, decodeProductId } from "@store/contracts";
import { fireEvent, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";

import { ProductTableFilters, useProductsTable } from "@/components/products/table";
import { DataTable, DataTableContent } from "@/components/shared/data-table";

import { renderWithRouter } from "../../lib/render";

const metadata = {
  organizationId: "org-1",
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: "device-1",
  operationId: "operation-1",
  rowVersion: 1,
  createdAt: Date.UTC(2026, 0, 1),
  updatedAt: Date.UTC(2026, 0, 1),
};

const category = (id: string, name: string): Category => ({
  id: decodeCategoryId(id),
  name,
  tracksPacks: true,
  ...metadata,
});

const product = (
  id: string,
  name: string,
  details: Pick<Product, "aisle" | "composition" | "strength" | "category">,
): Product => ({
  id: decodeProductId(id),
  name,
  categoryId: details.category.id,
  unitsPerPack: 10,
  packPrice: 1_000,
  unitPrice: 100,
  visible: true,
  batches: [],
  ...metadata,
  ...details,
});

const products = [
  product("panadol", "Panadol", {
    category: category("medicine", "Medicine"),
    composition: "Paracetamol",
    aisle: "A1",
    strength: "500mg",
  }),
  product("brufen", "Brufen", {
    category: category("medicine", "Medicine"),
    composition: "Ibuprofen",
    aisle: "A2",
    strength: "400mg",
  }),
  product("soap", "Soap", {
    category: category("personal-care", "Personal care"),
    composition: null,
    aisle: "B1",
    strength: null,
  }),
];

function ProductTableHarness() {
  const table = useProductsTable(products);
  return (
    <DataTable table={table}>
      <ProductTableFilters products={products} />
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

test("product filters compose and clear across catalog fields", async () => {
  renderWithRouter(<ProductTableHarness />);

  await choose("Category", "Medicine");
  await choose("Composition", "Paracetamol");
  await choose("Aisle", "A1");
  await choose("Strength", "500mg");
  expect(screen.getByText("Panadol")).toBeTruthy();
  expect(screen.queryByText("Brufen")).toBeNull();
  expect(screen.queryByText("Soap")).toBeNull();

  const trigger = screen.getByRole("button", { name: "Filter products" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  clickMenuItem(await screen.findByRole("menuitem", { name: "Clear filters" }));
  const table = screen.getByRole("table");
  expect(within(table).getByText("Panadol")).toBeTruthy();
  expect(within(table).getByText("Brufen")).toBeTruthy();
  expect(within(table).getByText("Soap")).toBeTruthy();
});
