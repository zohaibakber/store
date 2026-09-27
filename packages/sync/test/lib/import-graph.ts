import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";

import * as Schema from "effect/Schema";

export const packageRoot = resolve(import.meta.dirname, "../..");
const workspaceRoot = resolve(packageRoot, "..");

const SOURCE_IMPORT_PATTERN = /(?:from|import)\s*["']([^"']+)["']/gu;

const DIST_IMPORT_PATTERN = /^\s*(?:import|export)\b[^;]*?["']([^"']+)["'];?\s*$/gmu;

const TYPE_ONLY_PATTERN = /(?:import|export)\s+type\s[^;]*?from\s*["'][^"']+["']/gsu;

const PackageManifest = Schema.Struct({
  exports: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

const decodeManifest = Schema.decodeUnknownSync(Schema.fromJsonString(PackageManifest));

const packageExports = (packageName: string) => {
  const folder = packageName.replace("@store/", "");
  const manifest = resolve(workspaceRoot, folder, "package.json");
  const mapped = new Map<string, string>();
  if (!existsSync(manifest)) return mapped;
  const parsed = decodeManifest(readFileSync(manifest, "utf8"));
  for (const [key, value] of Object.entries(parsed.exports ?? {})) {
    mapped.set(key, resolve(workspaceRoot, folder, value));
  }
  return mapped;
};

const resolveFile = (candidate: string): string | undefined => {
  for (const suffix of ["", ".ts", ".tsx", "/index.ts"]) {
    const full = `${candidate}${suffix}`;
    if (existsSync(full) && !full.endsWith("/")) {
      if (suffix === "" && !/\.(?:ts|tsx|js)$/u.test(full)) continue;
      return full;
    }
  }
  return undefined;
};

const followedPackages = (follow: ReadonlyArray<string>) =>
  new Map(
    follow.map((name) => [name, realpathSync(resolve(packageRoot, "node_modules", name))] as const),
  );

const resolvePackageFile = (
  specifier: string,
  followed: ReadonlyMap<string, string>,
): string | undefined => {
  for (const [name, root] of followed) {
    if (specifier === name) return resolveFile(resolve(root, "index.js"));
    if (specifier.startsWith(`${name}/`)) {
      return resolveFile(resolve(root, `${specifier.slice(name.length + 1)}.js`));
    }
  }
  return undefined;
};

const resolveSpecifier = (
  specifier: string,
  fromFile: string,
  followed: ReadonlyMap<string, string>,
): string | undefined => {
  if (specifier.startsWith(".")) return resolveFile(resolve(dirname(fromFile), specifier));
  if (specifier.startsWith("@store/")) {
    const [scope, name, ...rest] = specifier.split("/");
    const subpath = rest.length > 0 ? `./${rest.join("/")}` : ".";
    return packageExports(`${scope}/${name}`).get(subpath);
  }
  return resolvePackageFile(specifier, followed);
};

const importsOf = (file: string): ReadonlyArray<string> => {
  const source = readFileSync(file, "utf8");
  const pattern = file.endsWith(".js") ? DIST_IMPORT_PATTERN : SOURCE_IMPORT_PATTERN;
  const stripped = file.endsWith(".js") ? source : source.replaceAll(TYPE_ONLY_PATTERN, "");
  return [...stripped.matchAll(pattern)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
};

export const collectGraph = (entry: string, follow: ReadonlyArray<string> = []) => {
  const followed = followedPackages(follow);
  const files = new Set<string>();
  const bare = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || files.has(file)) continue;
    files.add(file);
    for (const specifier of importsOf(file)) {
      const resolved = resolveSpecifier(specifier, file, followed);
      if (resolved === undefined) {
        bare.add(specifier);
        continue;
      }
      pending.push(resolved);
    }
  }
  return { files, bare };
};

export const matchingSpecifiers = (
  bare: ReadonlySet<string>,
  forbidden: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  [...bare].filter(
    (specifier) =>
      specifier.startsWith("node:") ||
      forbidden.some(
        (prefix) =>
          specifier === prefix ||
          specifier.startsWith(prefix.endsWith("-") ? prefix : `${prefix}/`),
      ),
  );
