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
  expect(
    phaseAfter(
      [{ type: "error", message: "boom", retrying: false, failure: "other" }],
      "downloading",
    ),
  ).toBe("idle");
});

const available: UpdaterEvent = { type: "available", version: "1.2.3" };
const failed: UpdaterEvent = { type: "error", message: "boom", retrying: false, failure: "other" };

test.each([
  ["idle", available, true],
  ["downloading", available, false],
  ["downloaded", available, false],
  ["idle", failed, true],
  ["downloading", failed, false],
] as const)("withholds availability and errors unless idle: %s %o", (phase, event, expected) => {
  expect(forwardsToRenderer(phase, event)).toBe(expected);
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
    "net::ERR_NETWORK_CHANGED",
    "net::ERR_NAME_NOT_RESOLVED",
    "net::ERR_CONNECTION_TIMED_OUT",
    "Failed to fetch",
    "getaddrinfo ENOTFOUND github.com",
    "connect ECONNREFUSED 127.0.0.1:443",
    "read ECONNRESET",
    "connect ETIMEDOUT",
  ])
    expect(classifyUpdateFailure(message)).toBe("network");

  expect(classifyUpdateFailure("HttpError: 500 Internal Server Error")).toBe("other");
  expect(updateFailureMessage("net::ERR_NETWORK_CHANGED")).toBe("You're offline.");
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
