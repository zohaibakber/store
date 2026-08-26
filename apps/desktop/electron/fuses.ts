import { FuseV1Options, FuseVersion } from "@electron/fuses";

/**
 * Package-time Electron fuses. Matches the PowerSync example-electron Forge
 * plugin and the official Electron fuse recommendations for apps that serve
 * the renderer over a custom protocol instead of `file://`.
 *
 * `LoadBrowserProcessSpecificV8Snapshot` stays off: a custom main-process
 * snapshot disables Electron's embedded Node startup snapshot and slows boot.
 */
export const desktopFuses = {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
} as const;
