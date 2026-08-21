import { describe, expect, it } from "vitest";

import { batchMutationTarget } from "../src/features/products/batch-mutation-target";

describe("batchMutationTarget", () => {
  it("targets an existing batch when selected", () => {
    expect(batchMutationTarget("batch-1", "new-batch")).toEqual({ batchId: "batch-1" });
  });

  it("uses the prepared new batch id when creating", () => {
    expect(batchMutationTarget(null, "new-batch")).toEqual({
      batchId: null,
      newBatchId: "new-batch",
    });
  });
});
