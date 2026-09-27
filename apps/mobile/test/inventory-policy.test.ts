import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";

import {
  decodeMobileExtra,
  isReachable,
  reconnected,
  replicaDatabaseName,
  visibilityForAppState,
} from "../src/inventory/policy";

describe("mobile replica policy", () => {
  it("names one database file per API origin, organization, and user", () => {
    const name = replicaDatabaseName("https://api.example.test/api/", "org/1", "user 1");
    expect(name).toBe(
      `tabaaq-replica-v1-${encodeURIComponent("https://api.example.test:org/1:user 1")}.sqlite`,
    );
    expect(name).not.toContain("/");
    expect(replicaDatabaseName("https://api.example.test", "org/1", "user 2")).not.toBe(name);
    expect(replicaDatabaseName("https://staging.example.test", "org/1", "user 1")).not.toBe(name);
  });

  it("reads the API base URL from the Expo config extra", () => {
    expect(
      decodeMobileExtra({ apiBaseUrl: "https://api.example.test", variant: "x" }),
    ).toStrictEqual(Option.some({ apiBaseUrl: "https://api.example.test" }));
    expect(Option.isNone(decodeMobileExtra({ apiBaseUrl: "" }))).toBe(true);
    expect(Option.isNone(decodeMobileExtra(undefined))).toBe(true);
  });

  it("wakes on a transition from unreachable to reachable only", () => {
    expect(isReachable({ isConnected: true, isInternetReachable: false })).toBe(false);
    expect(isReachable({ isConnected: true })).toBe(true);
    expect(isReachable({})).toBe(false);
    expect(reconnected(false, true)).toBe(true);
    expect(reconnected(undefined, true)).toBe(false);
    expect(reconnected(true, true)).toBe(false);
    expect(reconnected(false, false)).toBe(false);
  });

  it("maps app states to scheduler visibility", () => {
    expect(visibilityForAppState("active")).toBe("foreground");
    expect(visibilityForAppState("background")).toBe("background");
    expect(visibilityForAppState("inactive")).toBe("unchanged");
  });
});
