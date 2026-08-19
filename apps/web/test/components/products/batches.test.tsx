// @vitest-environment happy-dom
import type { Batch, Category, Product } from "@store/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ProductBatchesCard } from "@/components/products/batches";

import { renderWithStore } from "../../lib/render";
import { storeStub } from "../../lib/store-stub";

// happy-dom has no Web Animations API, and the sheet's scroll area asks for it
// on a timer after the test has finished, so it shows up as an unhandled error.
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
  id: "medicine",
  name: "Medicine",
  tracksPacks: true,
  ...syncMetadata,
};

const batch: Batch = {
  id: "batch-1",
  productId: "product-1",
  batchNumber: "BN-typo",
  // Local midnight, the same convention the batch form reads and writes.
  expiresAt: new Date(2027, 0, 31).getTime(),
  packQuantity: 2,
  unitQuantity: 3,
  ...syncMetadata,
};

const product: Product = {
  id: "product-1",
  name: "Panadol",
  categoryId: "general",
  aisle: null,
  composition: null,
  strength: null,
  unitsPerPack: 10,
  packPrice: 1500,
  unitPrice: 200,
  visible: true,
  category,
  batches: [batch],
  ...syncMetadata,
};

const openEditSheet = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Edit batch" }));
  return screen.findByLabelText<HTMLInputElement>("Batch number");
};

const save = () => fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

test("a batch can be renamed from the product page", async () => {
  const updateBatch = vi.fn(() => Promise.resolve(batch));
  renderWithStore(<ProductBatchesCard product={product} />, storeStub({ updateBatch }));

  const input = await openEditSheet();
  expect(input.value).toBe("BN-typo");

  fireEvent.change(input, { target: { value: "  BN-1234  " } });
  save();

  await waitFor(() => {
    expect(updateBatch).toHaveBeenCalledWith({
      id: "batch-1",
      batchNumber: "BN-1234",
      expiresAt: batch.expiresAt,
      packQuantity: batch.packQuantity,
      unitQuantity: batch.unitQuantity,
    });
  });
});

test("clearing the batch number stores no batch number", async () => {
  const updateBatch = vi.fn(() => Promise.resolve(batch));
  renderWithStore(<ProductBatchesCard product={product} />, storeStub({ updateBatch }));

  fireEvent.change(await openEditSheet(), { target: { value: "" } });
  save();

  await waitFor(() => {
    expect(updateBatch).toHaveBeenCalledWith({
      id: "batch-1",
      batchNumber: null,
      expiresAt: batch.expiresAt,
      packQuantity: batch.packQuantity,
      unitQuantity: batch.unitQuantity,
    });
  });
});

test("a miscounted batch can be corrected from the edit sheet", async () => {
  const updateBatch = vi.fn(() => Promise.resolve(batch));
  renderWithStore(<ProductBatchesCard product={product} />, storeStub({ updateBatch }));

  await openEditSheet();
  const packs = screen.getByLabelText<HTMLInputElement>("Sealed packs");
  expect(packs.value).toBe("2");

  fireEvent.change(packs, { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText("Loose units"), { target: { value: "0" } });
  save();

  await waitFor(() => {
    expect(updateBatch).toHaveBeenCalledWith({
      id: "batch-1",
      batchNumber: "BN-typo",
      expiresAt: batch.expiresAt,
      packQuantity: 5,
      unitQuantity: 0,
    });
  });
});
