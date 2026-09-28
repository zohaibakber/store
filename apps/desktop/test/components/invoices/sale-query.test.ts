import { describe, expect, it } from "vitest";

import { formatInvoiceTime } from "@/components/invoices/invoice-time";
import { parseSaleQuery } from "@/components/invoices/sale-query";

describe("parseSaleQuery", () => {
  it("defaults to one of the typed term", () => {
    expect(parseSaleQuery("  pana ")).toEqual({ quantity: 1, term: "pana" });
  });

  it("reads a star quantity prefix", () => {
    expect(parseSaleQuery("3*pana")).toEqual({ quantity: 3, term: "pana" });
    expect(parseSaleQuery("12 * panadol cf")).toEqual({ quantity: 12, term: "panadol cf" });
  });

  it("reads an x prefix only when followed by a space", () => {
    expect(parseSaleQuery("2x pana")).toEqual({ quantity: 2, term: "pana" });
    expect(parseSaleQuery("2 X pana")).toEqual({ quantity: 2, term: "pana" });
    expect(parseSaleQuery("2xylo")).toEqual({ quantity: 1, term: "2xylo" });
  });

  it("keeps an empty term while the name is still being typed", () => {
    expect(parseSaleQuery("3*")).toEqual({ quantity: 3, term: "" });
  });

  it("ignores a zero quantity", () => {
    expect(parseSaleQuery("0*pana")).toEqual({ quantity: 1, term: "0*pana" });
  });
});

describe("formatInvoiceTime", () => {
  const now = new Date(2026, 8, 29, 15, 0).getTime();

  it("labels today and yesterday relatively", () => {
    expect(formatInvoiceTime(new Date(2026, 8, 29, 9, 5).getTime(), now)).toMatch(/^Today, 9:05/);
    expect(formatInvoiceTime(new Date(2026, 8, 28, 21, 47).getTime(), now)).toMatch(
      /^Yesterday, 9:47/,
    );
  });

  it("uses a compact absolute date otherwise", () => {
    expect(formatInvoiceTime(new Date(2026, 8, 27, 21, 47).getTime(), now)).toBe("27 Sep, 9:47 PM");
    expect(formatInvoiceTime(new Date(2025, 0, 3, 8, 0).getTime(), now)).toBe("3 Jan 2025");
  });
});
