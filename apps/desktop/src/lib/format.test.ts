import { describe, expect, it } from "vitest";

import { parseExpiryDate } from "./format";

const dayMonthYear = (timestamp: number | null) => {
  if (timestamp == null) return null;
  const date = new Date(timestamp);
  return [date.getDate(), date.getMonth() + 1, date.getFullYear()];
};

describe("parseExpiryDate", () => {
  it("reads the day-first format invoices use", () => {
    expect(dayMonthYear(parseExpiryDate("31-12-2027"))).toEqual([31, 12, 2027]);
  });

  it("reads an ambiguous date day-first rather than month-first", () => {
    // Date.parse would read this as 5 June; the invoice means 5 June only if
    // day comes first, so the distinction has to be explicit.
    expect(dayMonthYear(parseExpiryDate("05-06-2027"))).toEqual([5, 6, 2027]);
  });

  it("accepts slash separators", () => {
    expect(dayMonthYear(parseExpiryDate("01/02/2028"))).toEqual([1, 2, 2028]);
  });

  it("still accepts ISO dates, which CSV exports commonly use", () => {
    expect(dayMonthYear(parseExpiryDate("2027-12-31"))).toEqual([31, 12, 2027]);
  });

  it("returns null for absent or blank values", () => {
    expect(parseExpiryDate(null)).toBeNull();
    expect(parseExpiryDate("")).toBeNull();
    expect(parseExpiryDate("   ")).toBeNull();
  });

  it("returns null rather than guessing at an unreadable date", () => {
    expect(parseExpiryDate("not a date")).toBeNull();
    expect(parseExpiryDate("13/13/2027")).toBeNull();
  });

  it("returns null for an impossible day", () => {
    expect(parseExpiryDate("31-02-2027")).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(dayMonthYear(parseExpiryDate("  31-12-2027  "))).toEqual([31, 12, 2027]);
  });
});
