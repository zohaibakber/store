import { describe, expect, it } from "vitest";

import { parseExpiryDate } from "@/lib/format";

const dayMonthYear = (timestamp: number | null) => {
  if (timestamp == null) return null;
  const date = new Date(timestamp);
  return [date.getDate(), date.getMonth() + 1, date.getFullYear()];
};

describe("parseExpiryDate", () => {
  it.each([
    ["31-12-2027", [31, 12, 2027]],
    ["05-06-2027", [5, 6, 2027]],
    ["01/02/2028", [1, 2, 2028]],
    ["2027-12-31", [31, 12, 2027]],
    ["  31-12-2027  ", [31, 12, 2027]],
    [null, null],
    ["", null],
    ["   ", null],
    ["not a date", null],
    ["13/13/2027", null],
    ["31-02-2027", null],
  ])("reads %j day-first", (input, expected) => {
    expect(dayMonthYear(parseExpiryDate(input))).toEqual(expected);
  });
});
