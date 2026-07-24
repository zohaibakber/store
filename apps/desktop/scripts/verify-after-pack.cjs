const { statSync } = require("node:fs");
const path = require("node:path");
const { extractFile, listPackage } = require("@electron/asar");

const MAX_RUNTIME_PACKAGES = 40;
const MAX_ASAR_BYTES = 80 * 1024 * 1024;

const forbiddenPackageRoots = new Set([
  "@store/auth",
  "@store/contracts",
  "@store/db",
  "@store/persistence",
  "@store/services",
  "better-auth",
  "drizzle-orm",
  "effect",
  "hono",
  "kysely",
  "pg",
  "wrangler",
]);

const forbiddenRendererMarkers = [
  "categories_organization_id_name_uidx",
  "products_organization_id_category_id_idx",
  "invoices_organization_id_invoice_number_uidx",
  "invoice_counters",
  "drizzle-orm",
];

const forbiddenServerMarkers = [
  "HYPERDRIVE",
  "@cf/meta/llama",
  "Store Invoice API",
  "sync_inbox_organization_operation_pk",
  "sync_change_log_organization_operation_ordinal_uidx",
  "organization_slug_uidx",
];

const allowedTopLevelRoots = new Set(["dist", "dist-electron", "node_modules", "package.json"]);

const packageRoot = (entry) => {
  const parts = entry.split("/").filter(Boolean);
  if (parts.at(-1) !== "package.json") return undefined;

  const nodeModulesIndex = parts.lastIndexOf("node_modules");
  const packageName = parts[nodeModulesIndex + 1];
  if (nodeModulesIndex < 0 || !packageName) return undefined;

  if (packageName.startsWith("@")) {
    const scopedName = parts[nodeModulesIndex + 2];
    return scopedName && parts[nodeModulesIndex + 3] === "package.json"
      ? `${packageName}/${scopedName}`
      : undefined;
  }

  return parts[nodeModulesIndex + 2] === "package.json" ? packageName : undefined;
};

const fail = (message, details = []) => {
  const suffix =
    details.length > 0 ? `\n${details.map((detail) => `  - ${detail}`).join("\n")}` : "";
  throw new Error(`[desktop-boundary] ${message}${suffix}`);
};

const verifyDesktopAsar = (archivePath) => {
  const archiveBytes = statSync(archivePath).size;
  if (archiveBytes > MAX_ASAR_BYTES) {
    fail(
      `app.asar is ${(archiveBytes / 1024 / 1024).toFixed(1)} MB; expected no more than ${MAX_ASAR_BYTES / 1024 / 1024} MB`,
    );
  }

  // @electron/asar returns OS-native separators (backslash on Windows), but every
  // check below compares against posix-style constants and splits on "/". Keep the
  // raw form too: extractFile() internally splits on path.sep, so feeding it a
  // posix-normalized path fails to resolve the file on Windows.
  const rawEntries = listPackage(archivePath);
  const toPosix = (entry) => entry.replaceAll("\\", "/");
  const entries = rawEntries.map(toPosix);
  const rawByPosix = new Map(entries.map((entry, index) => [entry, rawEntries[index]]));
  const entrySet = new Set(entries);
  const packageRoots = new Set(entries.map(packageRoot).filter(Boolean));
  const topLevelRoots = new Set(
    entries.map((entry) => entry.split("/").filter(Boolean)[0]).filter(Boolean),
  );

  const unexpectedTopLevelRoots = [...topLevelRoots].filter(
    (root) => !allowedTopLevelRoots.has(root),
  );
  if (unexpectedTopLevelRoots.length > 0) {
    fail("unexpected source roots were copied into the desktop artifact", unexpectedTopLevelRoots);
  }

  const environmentFiles = entries.filter((entry) => /\/\.env(?:\.|$)/u.test(entry));
  if (environmentFiles.length > 0) {
    fail("environment files were packaged", environmentFiles);
  }

  const forbiddenPackages = [...packageRoots].filter(
    (root) =>
      root.startsWith("@store/") ||
      root.startsWith("@better-auth/") ||
      root.startsWith("@effect/") ||
      forbiddenPackageRoots.has(root),
  );
  if (forbiddenPackages.length > 0) {
    fail(
      "server or bundled-source packages were copied into the desktop artifact",
      forbiddenPackages,
    );
  }

  if (packageRoots.size > MAX_RUNTIME_PACKAGES) {
    fail(
      `desktop artifact contains ${packageRoots.size} runtime packages; expected at most ${MAX_RUNTIME_PACKAGES}`,
      [...packageRoots].sort((left, right) => left.localeCompare(right)),
    );
  }

  const requiredEntries = [
    "/dist/index.html",
    "/dist-electron/main.js",
    "/dist-electron/preload.mjs",
    "/node_modules/@electric-sql/pglite/package.json",
    "/node_modules/electron-updater/package.json",
  ];
  const missingEntries = requiredEntries.filter((entry) => !entrySet.has(entry));
  if (missingEntries.length > 0) {
    fail("required local-first runtime files are missing", missingEntries);
  }

  const rendererEntries = entries.filter(
    (entry) => entry.startsWith("/dist/assets/") && entry.endsWith(".js"),
  );
  const rendererLeaks = [];
  for (const entry of rendererEntries) {
    const source = extractFile(archivePath, rawByPosix.get(entry).slice(1)).toString("utf8");
    for (const marker of forbiddenRendererMarkers) {
      if (source.includes(marker)) rendererLeaks.push(`${entry}: ${marker}`);
    }
  }
  if (rendererLeaks.length > 0) {
    fail("database schema code reached the renderer bundle", rendererLeaks);
  }

  const desktopJavaScriptEntries = entries.filter(
    (entry) =>
      (entry.startsWith("/dist/") || entry.startsWith("/dist-electron/")) &&
      (entry.endsWith(".js") || entry.endsWith(".mjs")),
  );
  const serverLeaks = [];
  for (const entry of desktopJavaScriptEntries) {
    const source = extractFile(archivePath, rawByPosix.get(entry).slice(1)).toString("utf8");
    for (const marker of forbiddenServerMarkers) {
      if (source.includes(marker)) serverLeaks.push(`${entry}: ${marker}`);
    }
  }
  if (serverLeaks.length > 0) {
    fail("Cloudflare server implementation code reached the desktop bundle", serverLeaks);
  }

  console.log(
    `[desktop-boundary] verified ${path.basename(archivePath)}: ${(archiveBytes / 1024 / 1024).toFixed(1)} MB, ${packageRoots.size} runtime packages`,
  );
};

const afterPack = async (context) => {
  const resourcesDirectory = context.packager.getResourcesDir(context.appOutDir);
  verifyDesktopAsar(path.join(resourcesDirectory, "app.asar"));
};

module.exports = afterPack;
module.exports.verifyDesktopAsar = verifyDesktopAsar;

if (require.main === module) {
  const archivePath = process.argv[2];
  if (!archivePath) fail("usage: node scripts/verify-after-pack.cjs <path-to-app.asar>");
  verifyDesktopAsar(path.resolve(archivePath));
}
