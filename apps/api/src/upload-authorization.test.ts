import { describe, expect, it } from "vitest";
import { appFor } from "./app.test-support";

describe("upload authorization", () => {
  it("denies unauthenticated upload requests", async () => {
    const response = await appFor(false, false).request("/api/uploads", { method: "POST" });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("denies users who are no longer active organization members", async () => {
    const response = await appFor(false).request("/api/uploads", { method: "POST" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "ORGANIZATION_ACCESS_DENIED" },
    });
  });

  it("allows members through upload authorization before validating input", async () => {
    const response = await appFor(true).request("/api/uploads", { method: "POST" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "FILES_REQUIRED" } });
  });
});
