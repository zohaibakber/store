import { describe, expect, it } from "vitest";

import { inventoryApiRoot } from "../src/mutations";

describe("inventoryApiRoot", () => {
  it("appends /api unless the base already ends with it", () => {
    expect(inventoryApiRoot("https://api.example")).toBe("https://api.example/api");
    expect(inventoryApiRoot("https://api.example/")).toBe("https://api.example/api");
    expect(inventoryApiRoot("https://api.example/api")).toBe("https://api.example/api");
    expect(inventoryApiRoot("https://api.example/api/")).toBe("https://api.example/api");
  });
});
