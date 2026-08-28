import { describe, expect, it } from "vitest";

import { isNewSaleAccelerator } from "../../electron/new-sale-accelerator";

const keyN = {
  type: "keyDown",
  key: "n",
  code: "KeyN",
  control: true,
  meta: false,
  alt: false,
  shift: false,
} as const;

describe("isNewSaleAccelerator", () => {
  it("matches Control+N and Command+N", () => {
    expect(isNewSaleAccelerator(keyN)).toBe(true);
    expect(isNewSaleAccelerator({ ...keyN, control: false, meta: true })).toBe(true);
  });

  it("ignores repeats of other modifiers and keys", () => {
    expect(isNewSaleAccelerator({ ...keyN, type: "keyUp" })).toBe(false);
    expect(isNewSaleAccelerator({ ...keyN, shift: true })).toBe(false);
    expect(isNewSaleAccelerator({ ...keyN, alt: true })).toBe(false);
    expect(isNewSaleAccelerator({ ...keyN, code: "KeyK", key: "k" })).toBe(false);
  });
});
