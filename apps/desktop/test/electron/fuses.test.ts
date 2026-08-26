import { FuseV1Options } from "@electron/fuses";
import { describe, expect, it } from "vitest";

import { desktopFuses } from "../../electron/fuses";
import { isTrustedIpcSenderFrame } from "../../electron/ipc-sender";

describe("desktop Electron fuses", () => {
  it("disables living-off-the-land Node entry points and file:// privileges", () => {
    expect(desktopFuses[FuseV1Options.RunAsNode]).toBe(false);
    expect(desktopFuses[FuseV1Options.EnableCookieEncryption]).toBe(true);
    expect(desktopFuses[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(false);
    expect(desktopFuses[FuseV1Options.EnableNodeCliInspectArguments]).toBe(false);
    expect(desktopFuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]).toBe(true);
    expect(desktopFuses[FuseV1Options.OnlyLoadAppFromAsar]).toBe(true);
    expect(desktopFuses[FuseV1Options.GrantFileProtocolExtraPrivileges]).toBe(false);
  });
});

describe("trusted IPC sender", () => {
  it("rejects missing frames and prefix-similar hosts", () => {
    expect(isTrustedIpcSenderFrame(null, ["com.tabaaq.desktop://app"])).toBe(false);
    expect(
      isTrustedIpcSenderFrame(
        { url: "com.tabaaq.desktop://app.attacker.example/" } as never,
        ["com.tabaaq.desktop://app"],
      ),
    ).toBe(false);
    expect(
      isTrustedIpcSenderFrame(
        { url: "com.tabaaq.desktop://app/inventory" } as never,
        ["com.tabaaq.desktop://app"],
      ),
    ).toBe(true);
  });
});
