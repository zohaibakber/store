import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { describe, expect, it, vi } from "vitest";

import type { ServerRuntimeContract } from "../../src/http/runtime";
import { appFor } from "../lib/app";

describe("Electric shape routes", () => {
  it("rejects an unauthenticated shape request before proxying", async () => {
    const proxy = vi.fn<ServerRuntimeContract["proxyElectric"]>(() =>
      Effect.succeed(HttpServerResponse.empty()),
    );
    const response = await appFor(false, { proxyElectric: proxy }).request(
      "/api/electric/products?offset=-1",
    );

    expect(response.status).toBe(401);
    expect(proxy).not.toHaveBeenCalled();
  });

  it("uses the organization from the verified session", async () => {
    const proxy = vi.fn<ServerRuntimeContract["proxyElectric"]>(() =>
      Effect.succeed(HttpServerResponse.text("shape")),
    );
    const response = await appFor(true, {
      proxyElectric: proxy,
    }).request("/api/electric/products?offset=-1&organizationId=other-org");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("shape");
    expect(proxy).toHaveBeenCalledWith(
      expect.objectContaining({ table: "products", organizationId: "org-1" }),
    );
  });

  it("does not expose arbitrary table routes", async () => {
    const response = await appFor(true).request("/api/electric/users?offset=-1");

    expect(response.status).toBe(404);
  });
});
