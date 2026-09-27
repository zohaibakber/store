// @vitest-environment happy-dom
import { unauthenticatedWorkspace } from "@store/contracts";
import { describe, expect, it } from "vitest";

import { electronAppHost } from "../src/electron-host";
import { appHost, installAppHost } from "../src/host";
import { altNewSaleShortcut, controlNewSaleShortcut } from "../src/lib/new-sale-shortcut";

const extraction = { supplier: null, invoiceNumber: null, lines: [] };

const preload = () => {
  const uploads: Array<ReadonlyArray<{ readonly name: string }>> = [];
  const opened: Array<string> = [];
  const snapshot = unauthenticatedWorkspace({ isOnline: true });
  const auth: NonNullable<Window["auth"]> = {
    getSession: async () => snapshot,
    adoptSession: async () => snapshot,
    renewSession: async () => snapshot,
    signOut: async () => undefined,
    organizationRoster: async () => Promise.reject(new Error("unused")),
    organize: async () => Promise.reject(new Error("unused")),
    openExternal: async (url) => {
      opened.push(url);
    },
    getOAuthRedirectUri: async () => "com.tabaaq.desktop://auth/callback",
    onOAuthCallback: (listener) => {
      listener("com.tabaaq.desktop://auth/callback?code=abc");
      return () => undefined;
    },
    onSessionChange: () => () => undefined,
  };
  const serverApi: NonNullable<Window["serverApi"]> = {
    analyseInvoices: async (input) => {
      uploads.push(input.files);
      return extraction;
    },
  };
  return { auth, serverApi, uploads, opened };
};

describe("app host", () => {
  it("fails loudly when read before startup installs it", () => {
    expect(() => appHost()).toThrow("The app host is not installed.");
  });

  it("installs one host for the renderer to read", () => {
    const bridges = preload();
    const host = electronAppHost(bridges);

    expect(installAppHost(host)).toBe(host);
    expect(appHost()).toBe(host);
  });
});

describe("Electron app host", () => {
  it("keeps the preload's session bridge and desktop client identity", async () => {
    const bridges = preload();
    const host = electronAppHost(bridges);
    const callbacks: Array<string> = [];

    expect(host.auth).toBe(bridges.auth);
    expect(host.signIn.client).toEqual({ _tag: "Native", deviceName: "Tabaaq Desktop" });
    await expect(host.signIn.oauthRedirectUri()).resolves.toBe(
      "com.tabaaq.desktop://auth/callback",
    );
    await host.signIn.openAuthorization("https://accounts.google.com/o/oauth2/v2/auth");
    host.signIn.onOAuthCallback?.((url) => callbacks.push(url));

    expect(bridges.opened).toEqual(["https://accounts.google.com/o/oauth2/v2/auth"]);
    expect(callbacks).toEqual(["com.tabaaq.desktop://auth/callback?code=abc"]);
  });

  it("forwards invoice files over the server bridge", async () => {
    const bridges = preload();
    const host = electronAppHost(bridges);
    const file = { name: "a.csv", type: "text/csv", bytes: new ArrayBuffer(1) };

    await expect(host.analyseInvoices([file])).resolves.toEqual(extraction);
    expect(bridges.uploads).toEqual([[file]]);
  });

  it("passes optional desktop capabilities through only when the preload exposes them", () => {
    const bridges = preload();
    const desktopShell = { onNewSale: () => () => undefined };
    const electronTheme = { setSource: () => undefined };

    const bare = electronAppHost(bridges);
    const full = electronAppHost({ ...bridges, desktopShell, electronTheme });

    expect(bare.shell).toBeUndefined();
    expect(bare.updater).toBeUndefined();
    expect(bare.theme).toBeUndefined();
    expect(full.shell).toBe(desktopShell);
    expect(full.theme).toBe(electronTheme);
    expect(full.newSaleShortcut).toBe(controlNewSaleShortcut);
  });

  it("requires the authentication bridge", () => {
    expect(() => electronAppHost({ serverApi: preload().serverApi })).toThrow(
      "Desktop authentication bridge is unavailable.",
    );
  });
});

describe("new sale shortcut", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", { code: "KeyN", ...init });

  it("uses Ctrl/⌘+N in Electron", () => {
    expect(controlNewSaleShortcut.matches(key({ ctrlKey: true }))).toBe(true);
    expect(controlNewSaleShortcut.matches(key({ metaKey: true }))).toBe(true);
    expect(controlNewSaleShortcut.matches(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(controlNewSaleShortcut.matches(key({ altKey: true }))).toBe(false);
  });

  it("uses Alt+N in the browser, which does not reserve it", () => {
    expect(altNewSaleShortcut.label).toBe("Alt+N");
    expect(altNewSaleShortcut.matches(key({ altKey: true }))).toBe(true);
    expect(altNewSaleShortcut.matches(key({ ctrlKey: true }))).toBe(false);
    expect(altNewSaleShortcut.matches(key({ altKey: true, metaKey: true }))).toBe(false);
  });
});
