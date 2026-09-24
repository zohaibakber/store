import { describe, expect, it } from "vitest";

import {
  expiryTimestamp,
  findExpiryMentions,
  formatExpiry,
  likelyExpiry,
  parseExpiry,
  readExpiryInput,
} from "../src/scan/expiry";

describe("parseExpiry", () => {
  it.each([
    ["EXP 08/27", { year: 2027, month: 8, day: null }],
    ["Exp. Date: 08-2027", { year: 2027, month: 8, day: null }],
    ["2027-08", { year: 2027, month: 8, day: null }],
    ["2027-08-15", { year: 2027, month: 8, day: 15 }],
    ["15/08/2027", { year: 2027, month: 8, day: 15 }],
    ["AUG 2027", { year: 2027, month: 8, day: null }],
    ["aug-27", { year: 2027, month: 8, day: null }],
    ["15 Aug 2027", { year: 2027, month: 8, day: 15 }],
    ["Use by 8.27", { year: 2027, month: 8, day: null }],
  ])("reads %s", (text, expected) => {
    expect(parseExpiry(text)).toEqual(expected);
  });

  it("rejects impossible dates and unrelated numbers", () => {
    expect(parseExpiry("31/02/2027")).toBeNull();
    expect(parseExpiry("500mg")).toBeNull();
    expect(parseExpiry("")).toBeNull();
  });
});

describe("findExpiryMentions", () => {
  it("labels expiry and manufacture dates and prefers the expiry", () => {
    const mentions = findExpiryMentions("MFG 02/25\nEXP 08/27\nB.No AB123");
    expect(mentions.map((mention) => [mention.raw, mention.label])).toEqual([
      ["02/25", "manufactured"],
      ["08/27", "expiry"],
    ]);
    expect(likelyExpiry(mentions)?.raw).toBe("08/27");
  });

  it("falls back to the latest unlabelled date", () => {
    expect(likelyExpiry(findExpiryMentions("02/2025 08/2027"))?.raw).toBe("08/2027");
  });

  it("does not read a full date twice", () => {
    expect(findExpiryMentions("12/08/2027")).toHaveLength(1);
  });
});

describe("expiry formatting", () => {
  it("formats month and day precision", () => {
    expect(formatExpiry({ year: 2027, month: 8, day: null })).toBe("08/2027");
    expect(formatExpiry({ year: 2027, month: 8, day: 5 })).toBe("05/08/2027");
  });

  it("stores a month-only expiry as the last day of that month", () => {
    const stored = new Date(expiryTimestamp({ year: 2027, month: 2, day: null }));
    expect([stored.getFullYear(), stored.getMonth() + 1, stored.getDate()]).toEqual([2027, 2, 28]);
    const exact = new Date(expiryTimestamp({ year: 2027, month: 8, day: 15 }));
    expect([exact.getFullYear(), exact.getMonth() + 1, exact.getDate()]).toEqual([2027, 8, 15]);
  });
});

describe("readExpiryInput", () => {
  const stored = (text: string) => {
    const input = readExpiryInput(text);
    return input._tag === "Valid" ? input.expiresAt : input._tag;
  };

  it("stores month and year as the last day of that month, like desktop", () => {
    expect(stored("08/27")).toBe(new Date(2027, 7, 31).getTime());
    expect(stored("08/2027")).toBe(new Date(2027, 7, 31).getTime());
    expect(stored("2028-02")).toBe(new Date(2028, 1, 29).getTime());
    expect(stored("Aug 2027")).toBe(new Date(2027, 7, 31).getTime());
    expect(stored("EXP 08/27")).toBe(new Date(2027, 7, 31).getTime());
  });

  it("stores a full date as local midnight of that day", () => {
    expect(stored("15/03/2028")).toBe(new Date(2028, 2, 15).getTime());
    expect(stored("2028-03-15")).toBe(new Date(2028, 2, 15).getTime());
  });

  it("reads what the scan review writes back", () => {
    const formatted = formatExpiry({ year: 2027, month: 8, day: null });
    expect(stored(formatted)).toBe(expiryTimestamp({ year: 2027, month: 8, day: null }));
  });

  it("separates empty from invalid input", () => {
    expect(stored("   ")).toBe("Empty");
    expect(stored("31/02/2027")).toBe("Invalid");
    expect(stored("13/27")).toBe("Invalid");
    expect(stored("soon")).toBe("Invalid");
    expect(stored("08/27 or 09/27")).toBe("Invalid");
    expect(stored("500mg 08/27")).toBe("Invalid");
  });
});
