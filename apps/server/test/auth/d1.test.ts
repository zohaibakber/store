import { describe, expect, it } from "vitest";

import { d1FromEnv, isD1Database } from "../../src/auth/d1";

const d1 = {
  prepare: () => ({}),
  batch: () => [],
  exec: () => ({}),
} as unknown as D1Database;

describe("d1FromEnv", () => {
  it("reads the Effect HTTP AuthDatabase binding", () => {
    expect(d1FromEnv({ AuthDatabase: d1 })).toBe(d1);
  });

  it("reads the Hono AUTH_DB binding", () => {
    expect(d1FromEnv({ AUTH_DB: d1 })).toBe(d1);
  });

  it("prefers AuthDatabase when both names are present", () => {
    const other = {
      prepare: () => ({}),
      batch: () => [],
      exec: () => ({}),
    } as unknown as D1Database;
    expect(d1FromEnv({ AuthDatabase: d1, AUTH_DB: other })).toBe(d1);
  });

  it("ignores a missing or empty env", () => {
    expect(d1FromEnv(undefined)).toBeUndefined();
    expect(d1FromEnv({})).toBeUndefined();
  });

  it("ignores a value that is not a D1 database", () => {
    expect(d1FromEnv({ AUTH_DB: "not-d1" })).toBeUndefined();
    expect(isD1Database(undefined)).toBe(false);
    expect(isD1Database({ prepare: "nope" })).toBe(false);
  });
});
