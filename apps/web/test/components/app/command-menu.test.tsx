// @vitest-environment happy-dom
import type { Category, Product } from "@store/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { CommandMenuProvider } from "@/components/app/command-menu";

import { renderWithStore } from "../../lib/render";
import { storeStub } from "../../lib/store-stub";

if (!("getAnimations" in Element.prototype))
  Object.defineProperty(Element.prototype, "getAnimations", { value: () => [] });

const syncMetadata = {
  organizationId: "org-1",
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: "device-1",
  operationId: "operation-1",
  rowVersion: 1,
  createdAt: Date.UTC(2026, 0, 1),
  updatedAt: Date.UTC(2026, 0, 1),
};

const category: Category = {
  id: "general",
  name: "General",
  tracksPacks: true,
  ...syncMetadata,
};

const product = (id: string, name: string): Product => ({
  id,
  name,
  categoryId: "general",
  aisle: null,
  composition: null,
  strength: null,
  unitsPerPack: 10,
  packPrice: 1500,
  unitPrice: 200,
  visible: true,
  category,
  batches: [],
  ...syncMetadata,
});

const products = [product("product-1", "Panadol"), product("product-2", "Brufen")];

const openMenu = () => fireEvent.keyDown(document, { key: "k", ctrlKey: true, code: "KeyK" });

test("ctrl+k opens the menu and lists the loaded products", async () => {
  const listProducts = vi.fn(() => Promise.resolve(products));
  renderWithStore(<CommandMenuProvider>app</CommandMenuProvider>, storeStub({ listProducts }));

  openMenu();

  expect(await screen.findByText("Panadol")).toBeTruthy();
  expect(screen.getByText("Brufen")).toBeTruthy();
  expect(screen.getAllByText("General")).toHaveLength(2);
});

test("a misspelled query still ranks the product it meant", async () => {
  const listProducts = vi.fn(() => Promise.resolve(products));
  renderWithStore(<CommandMenuProvider>app</CommandMenuProvider>, storeStub({ listProducts }));

  openMenu();
  const input = await screen.findByPlaceholderText<HTMLInputElement>("Search products…");
  fireEvent.change(input, { target: { value: "panadl" } });

  await waitFor(() => expect(screen.queryByText("Brufen")).toBeNull());
  expect(screen.getByText("Panadol")).toBeTruthy();
});

test("choosing a product opens its page", async () => {
  const listProducts = vi.fn(() => Promise.resolve(products));
  const { router } = renderWithStore(
    <CommandMenuProvider>app</CommandMenuProvider>,
    storeStub({ listProducts }),
  );

  openMenu();
  fireEvent.click(await screen.findByText("Panadol"));

  await waitFor(() => expect(router.state.location.pathname).toBe("/products/product-1"));

  openMenu();
  await waitFor(() => expect(listProducts).toHaveBeenCalledTimes(2));
});
