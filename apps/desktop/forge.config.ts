import { createRequire } from "node:module";
import { cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { PublisherGithub } from "@electron-forge/publisher-github";
import type { ForgeConfig } from "@electron-forge/shared-types";
import MakerAppImage from "@reforged/maker-appimage";

import { desktopFuses } from "./electron/fuses.js";

const require = createRequire(import.meta.url);
const { verifyDesktopAsar } = require("./scripts/verify-after-pack.cjs") as {
  verifyDesktopAsar: (archivePath: string) => void;
};

const root = path.dirname(fileURLToPath(import.meta.url));
const iconPng = path.join(root, "assets/prod/icon.png");

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: "Tabaaq",
    executableName: "tabaaq",
    appBundleId: "com.tabaaq.desktop",
    icon: path.join(root, "assets/prod/icon"),
    extraResource: [iconPng],
    protocols: [
      {
        name: "Tabaaq",
        schemes: ["com.tabaaq.desktop"],
      },
    ],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({
      options: {
        icon: iconPng,
        categories: ["Office"],
      },
    }),
    new MakerDeb({
      options: {
        icon: iconPng,
        maintainer: "Zohaib Akber <zohaibakber99@gmail.com>",
        categories: ["Office"],
        mimeType: ["x-scheme-handler/com.tabaaq.desktop"],
      },
    }),
    new MakerAppImage({
      options: {
        categories: ["Office"],
        icon: iconPng,
      },
    }),
  ],
  publishers: [
    new PublisherGithub({
      repository: { owner: "zohaibakber", name: "store" },
      draft: true,
      prerelease: false,
    }),
  ],
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      await cp(path.join(root, "dist"), path.join(buildPath, "dist"), { recursive: true });
    },
    postPackage: async (_forgeConfig, options) => {
      for (const outputPath of options.outputPaths) {
        const resources =
          process.platform === "darwin"
            ? path.join(outputPath, "Tabaaq.app", "Contents", "Resources")
            : path.join(outputPath, "resources");
        verifyDesktopAsar(path.join(resources, "app.asar"));
      }
    },
  },
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // Main + preload only. The renderer is the apps/web desktop build, served
      // over the custom `com.tabaaq.desktop` protocol — not a second Vite server.
      build: [
        {
          entry: "electron/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "electron/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [],
    }),
    new FusesPlugin({
      ...desktopFuses,
    }),
  ],
};

export default config;
