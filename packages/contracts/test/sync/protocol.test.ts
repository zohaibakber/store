import { describe, expect, it } from "vitest";

import { compareDecimalSequence, incrementDecimalSequence } from "../../src/sync/protocol";

describe("decimal sequences", () => {
  it("compares numerically rather than lexicographically", () => {
    expect(compareDecimalSequence("9", "10")).toBe(-1);
    expect(compareDecimalSequence("10", "9")).toBe(1);
    expect(compareDecimalSequence("01", "1")).toBe(0);
  });

  it("increments without floating point", () => {
    expect(incrementDecimalSequence("9")).toBe("10");
    expect(incrementDecimalSequence("0")).toBe("1");
  });
});
