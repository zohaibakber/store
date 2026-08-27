import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import * as Schema from "effect/Schema";

const execFileAsync = promisify(execFile);

const DesktopPackageManifest = Schema.Struct({
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

export const resolveDesktopRuntimeDependencies = (
  dependencies: Record<string, string> | undefined,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(dependencies ?? {}).filter(
      ([name, spec]) => name !== "electron" && !spec.startsWith("workspace:"),
    ),
  );

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
    await execFileAsync("vp", ["install", "--prod"], {
      cwd: stage,
      env: { ...process.env, npm_config_frozen_lockfile: "false" },
    });
    await cp(path.join(stage, "node_modules"), path.join(buildPath, "node_modules"), {
      recursive: true,
    });
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
};
