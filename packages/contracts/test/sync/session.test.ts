import { expect, test } from "vitest";

import { liveSocketUrl, SYNC_LIVE_PATH } from "../../src/sync/session";

test("liveSocketUrl upgrades http(s) and carries workspace identity", () => {
  const url = liveSocketUrl({
    baseUrl: "https://api.example.com",
    organizationId: "org-1",
    deviceId: "device-1",
    accessToken: "token",
  });

  expect(url.protocol).toBe("wss:");
  expect(url.pathname).toBe(SYNC_LIVE_PATH);
  expect(url.searchParams.get("organizationId")).toBe("org-1");
  expect(url.searchParams.get("deviceId")).toBe("device-1");
  expect(url.searchParams.get("protocolVersion")).toBe("2");
  expect(url.searchParams.get("access_token")).toBe("token");
});

test("liveSocketUrl upgrades http to ws", () => {
  const url = liveSocketUrl({
    baseUrl: "http://localhost:8787",
    organizationId: "org-1",
    deviceId: "device-1",
  });
  expect(url.protocol).toBe("ws:");
  expect(url.searchParams.has("access_token")).toBe(false);
});
