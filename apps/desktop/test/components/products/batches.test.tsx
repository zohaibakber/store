// @vitest-environment happy-dom
import type { Batch, Category, Product } from "@store/contracts";
import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { ProductBatchesCard } from "@/components/products/batches";

import { renderWithStore } from "../../lib/render";
import { storeStub } from "../../lib/store-stub";

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: () => Promise.resolve() }),
}));

// happy-dom has no Web Animations API, and the sheet's scroll area asks for it
// on a timer — after the test has finished, so it surfaces as an unhandled error.
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

const category: Category = { id: "general", name: "General", ...syncMetadata };

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

test("a batch can be renamed from the product page", async () => {
  const user = userEvent.setup();
  const updateBatch = vi.fn(() => Promise.resolve(batch));
  renderWithStore(<ProductBatchesCard product={product} />, storeStub({ updateBatch }));

  await user.click(screen.getByRole("button", { name: "Edit batch" }));

  const input = await screen.findByLabelText("Batch number");
  expect((input as HTMLInputElement).value).toBe("BN-typo");

  await user.clear(input);
  await user.type(input, "  BN-1234  ");
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => {
    expect(updateBatch).toHaveBeenCalledWith({
      id: "batch-1",
      batchNumber: "BN-1234",
      expiresAt: batch.expiresAt,
    });
  });
});

test("clearing the batch number stores no batch number", async () => {
  const user = userEvent.setup();
  const updateBatch = vi.fn(() => Promise.resolve(batch));
  renderWithStore(<ProductBatchesCard product={product} />, storeStub({ updateBatch }));

  await user.click(screen.getByRole("button", { name: "Edit batch" }));
  await user.clear(await screen.findByLabelText("Batch number"));
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => {
    expect(updateBatch).toHaveBeenCalledWith({
      id: "batch-1",
      batchNumber: null,
      expiresAt: batch.expiresAt,
    });
  });
});
