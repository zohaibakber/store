import { expect, test } from "vitest";

import {
  classifyUpdateFailure,
  forwardsToRenderer,
  nextUpdatePhase,
  updateFailureMessage,
  type UpdatePhase,
  type UpdaterEvent,
} from "../src/updater";

const phaseAfter = (events: ReadonlyArray<UpdaterEvent>, from: UpdatePhase = "idle") =>
  events.reduce(nextUpdatePhase, from);

test("a download run advances idle → downloading → downloaded", () => {
  expect(phaseAfter([{ type: "progress", percent: 10 }])).toBe("downloading");
  expect(
    phaseAfter([
      { type: "progress", percent: 10 },
      { type: "progress", percent: 90 },
      { type: "downloaded", version: "1.2.3" },
    ]),
  ).toBe("downloaded");
});

test("checking does not disturb an in-flight download", () => {
  expect(phaseAfter([{ type: "checking" }, { type: "not-available" }], "downloading")).toBe(
    "downloading",
  );
});

test("a failure returns to idle so the next check can run", () => {
  expect(phaseAfter([{ type: "error", message: "boom", retrying: false }], "downloading")).toBe(
    "idle",
  );
});

test("an available event is withheld unless nothing is downloading", () => {
  const available: UpdaterEvent = { type: "available", version: "1.2.3" };
  expect(forwardsToRenderer("idle", available)).toBe(true);
  expect(forwardsToRenderer("downloading", available)).toBe(false);
  expect(forwardsToRenderer("downloaded", available)).toBe(false);
});

test("an error during a download is withheld. The download reports it itself", () => {
  const failed: UpdaterEvent = { type: "error", message: "boom", retrying: false };
  expect(forwardsToRenderer("idle", failed)).toBe(true);
  expect(forwardsToRenderer("downloading", failed)).toBe(false);
});

test("progress and completion always reach the renderer", () => {
  for (const phase of ["idle", "downloading", "downloaded"] as const) {
    expect(forwardsToRenderer(phase, { type: "progress", percent: 1 })).toBe(true);
    expect(forwardsToRenderer(phase, { type: "downloaded", version: "1.2.3" })).toBe(true);
    expect(forwardsToRenderer(phase, { type: "checking" })).toBe(true);
  }
});

test("connectivity failures are classified apart from real ones", () => {
  for (const message of [
    "net::ERR_INTERNET_DISCONNECTED",
    "getaddrinfo ENOTFOUND github.com",
    "connect ECONNREFUSED 127.0.0.1:443",
    "read ECONNRESET",
    "connect ETIMEDOUT",
  ])
    expect(classifyUpdateFailure(message)).toBe("network");

  expect(classifyUpdateFailure("HttpError: 500 Internal Server Error")).toBe("other");
});

test("a release whose Linux metadata has not published yet is a delay, not a failure", () => {
  const message = "HttpError: 404 not found, cannot find latest-linux.yml in the latest release";
  expect(classifyUpdateFailure(message)).toBe("pending-release");
  expect(updateFailureMessage(message)).toContain("still publishing");
});

test("other failures are reported by their first line", () => {
  expect(updateFailureMessage("Something broke\nstack frame\nstack frame")).toBe("Something broke");
  expect(updateFailureMessage("")).toBe("Unable to check for updates.");
});
