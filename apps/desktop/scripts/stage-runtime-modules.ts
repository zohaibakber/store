import { execFile } from "node:child_process";
import { cp, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import * as Schema from "effect/Schema";

const execFileAsync = promisify(execFile);

const DesktopPackageManifest = Schema.Struct({
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

export const STAGE_WORKSPACE_YAML = "nodeLinker: hoisted\n";

export const resolveDesktopRuntimeDependencies = (
  dependencies: Record<string, string> | undefined,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(dependencies ?? {}).filter(
      ([name, spec]) => name !== "electron" && !spec.startsWith("workspace:"),
    ),
  );

export const copyStagedRuntimeModules = async (
  stagedNodeModules: string,
  buildPath: string,
): Promise<void> => {
  await cp(stagedNodeModules, path.join(buildPath, "node_modules"), {
    recursive: true,
    dereference: true,
  });
};

const assertPackableUpdaterManifest = async (buildPath: string): Promise<void> => {
  const manifest = path.join(buildPath, "node_modules", "electron-updater", "package.json");
  const info = await lstat(manifest);
  if (info.isSymbolicLink()) {
    throw new Error(`${manifest} is a symlink; Electron asar will not pack package.json inside it`);
  }
};

export const stageRuntimeModules = async (
  desktopRoot: string,
  buildPath: string,
): Promise<void> => {
  const pkg = Schema.decodeUnknownSync(DesktopPackageManifest)(
    JSON.parse(await readFile(path.join(desktopRoot, "package.json"), "utf8")),
  );
  const dependencies = resolveDesktopRuntimeDependencies(pkg.dependencies);
  const stage = await mkdtemp(path.join(tmpdir(), "tabaaq-desktop-runtime-"));
  try {
    await writeFile(
      path.join(stage, "package.json"),
      `${JSON.stringify(
        { name: "tabaaq-desktop-runtime", private: true, dependencies },
        null,
        2,
      )}\n`,
    );
    await writeFile(path.join(stage, "pnpm-workspace.yaml"), STAGE_WORKSPACE_YAML);
    await execFileAsync("vp", ["install", "--prod"], {
      cwd: stage,
      env: {
        ...process.env,
        npm_config_frozen_lockfile: "false",
        npm_config_node_linker: "hoisted",
      },
    });
    await copyStagedRuntimeModules(path.join(stage, "node_modules"), buildPath);
    await assertPackableUpdaterManifest(buildPath);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
};
