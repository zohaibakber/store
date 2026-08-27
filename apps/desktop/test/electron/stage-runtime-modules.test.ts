import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import {
  copyStagedRuntimeModules,
  resolveDesktopRuntimeDependencies,
  STAGE_WORKSPACE_YAML,
} from "../../scripts/stage-runtime-modules";

test("desktop runtime staging keeps updater packages and drops Electron plus workspace specs", () => {
  expect(
    resolveDesktopRuntimeDependencies({
      electron: "43.4.1",
      "electron-updater": "^6.8.9",
      "electron-squirrel-startup": "^1.0.1",
      "@store/auth": "workspace:*",
    }),
  ).toEqual({
    "electron-updater": "^6.8.9",
    "electron-squirrel-startup": "^1.0.1",
  });
});

test("staged workspace uses a hoisted linker so Forge asar sees real package files", () => {
  expect(STAGE_WORKSPACE_YAML).toContain("nodeLinker: hoisted");
});

test("copying staged node_modules dereferences pnpm package symlinks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tabaaq-runtime-copy-"));
  try {
    const realPackage = path.join(root, "real-electron-updater");
    const stagedNodeModules = path.join(root, "stage", "node_modules");
    const buildPath = path.join(root, "build");
    await mkdir(realPackage, { recursive: true });
    await mkdir(stagedNodeModules, { recursive: true });
    await mkdir(buildPath, { recursive: true });
    await writeFile(path.join(realPackage, "package.json"), '{"name":"electron-updater"}\n');
    await symlink(realPackage, path.join(stagedNodeModules, "electron-updater"));
    await copyStagedRuntimeModules(stagedNodeModules, buildPath);
    const packedManifest = path.join(buildPath, "node_modules", "electron-updater", "package.json");
    expect((await lstat(packedManifest)).isSymbolicLink()).toBe(false);
    await expect(readFile(packedManifest, "utf8")).resolves.toContain("electron-updater");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
