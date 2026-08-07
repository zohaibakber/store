// @vitest-environment happy-dom
import type { Category, Product } from "@store/contracts";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ProductTableFilters, useProductsTable } from "@/components/products/table";
import { DataTable, DataTableContent } from "@/components/shared/data-table";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#product">{children}</a>,
}));

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
  id,
  name,
  tracksPacks: true,
  ...metadata,
});

const product = (
  id: string,
  name: string,
  details: Pick<Product, "aisle" | "composition" | "strength" | "category">,
): Product => ({
  id,
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

const choose = (filter: string, option: string) => {
  fireEvent.click(screen.getByRole("combobox", { name: `Filter by ${filter}` }));
  const item = screen.getByRole("option", { name: option });
  fireEvent.pointerDown(item, { pointerType: "mouse" });
  fireEvent.click(item, { detail: 1 });
};

test("product filters compose and clear across catalog fields", () => {
  render(<ProductTableHarness />);

  choose("Categories", "Medicine");
  choose("Compositions", "Paracetamol");
  choose("Aisles", "A1");
  choose("Strengths", "500mg");
  expect(screen.getByText("Panadol")).toBeTruthy();
  expect(screen.queryByText("Brufen")).toBeNull();
  expect(screen.queryByText("Soap")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  const table = screen.getByRole("table");
  expect(within(table).getByText("Panadol")).toBeTruthy();
  expect(within(table).getByText("Brufen")).toBeTruthy();
  expect(within(table).getByText("Soap")).toBeTruthy();
});
