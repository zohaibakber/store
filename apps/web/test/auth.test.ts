import { describe, expect, it } from "vitest";

import { WebAuthBroker } from "../src/auth";

describe("WebAuthBroker", () => {
  it("starts unauthenticated before the first session lookup", () => {
    const auth = new WebAuthBroker("http://localhost:8787");
    expect(auth.snapshot).toMatchObject({
      status: "unauthenticated",
      user: null,
      activeOrganization: null,
      isOnline: false,
    });
  });
});
