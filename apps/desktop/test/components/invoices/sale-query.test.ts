import { describe, expect, it } from "vitest";

import { parseSaleQuery } from "@/components/invoices/sale-query";

describe("parseSaleQuery", () => {
  it.each([
    ["  pana ", 1, "pana"],
    ["3*pana", 3, "pana"],
    ["12 * panadol cf", 12, "panadol cf"],
    ["2x pana", 2, "pana"],
    ["2 X pana", 2, "pana"],
    ["2xylo", 1, "2xylo"],
    ["3*", 3, ""],
    ["0*pana", 1, "0*pana"],
  ])("parses %j", (query, quantity, term) => {
    expect(parseSaleQuery(query)).toEqual({ quantity, term });
  });
});
