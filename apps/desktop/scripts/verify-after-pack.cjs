const { statSync } = require("node:fs");
const path = require("node:path");
const { extractFile, listPackage } = require("@electron/asar");

// Live inventory is `@powersync/web` + wa-sqlite in the renderer (IndexedDB VFS).
// OPFS worker assets stay banned because this build has not switched to the OPFS VFS.
const MAX_ASAR_BYTES = 80 * 1024 * 1024;

const forbiddenPackageRoots = new Set([
  "@store/auth",
  "@store/contracts",
  "@store/db",
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
  "ORGANIZATION_STORE",
  "AUTH_DB",
  "@cf/meta/llama",
  "Store Invoice API",
  "sync_inbox_organization_operation_pk",
  "sync_change_log_organization_operation_ordinal_uidx",
  "organization_slug_uidx",
];

const allowedTopLevelRoots = new Set([".vite", "dist", "node_modules", "package.json"]);

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

  const browserPersistenceAssets = entries.filter((entry) =>
    /\/dist\/assets\/opfs-worker-[^/]+\.js$/u.test(entry),
  );
  if (browserPersistenceAssets.length > 0) {
    fail("browser OPFS persistence reached the desktop artifact", browserPersistenceAssets);
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

  const requiredEntries = [
    "/dist/index.html",
    "/.vite/build/main.js",
    "/.vite/build/preload.cjs",
    "/node_modules/electron-updater/package.json",
  ];
  const missingEntries = requiredEntries.filter((entry) => !entrySet.has(entry));
  if (missingEntries.length > 0) {
    fail("required runtime files are missing", missingEntries);
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
      (entry.startsWith("/dist/") || entry.startsWith("/.vite/")) &&
      (entry.endsWith(".js") || entry.endsWith(".mjs") || entry.endsWith(".cjs")),
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

module.exports = { verifyDesktopAsar };
module.exports.verifyDesktopAsar = verifyDesktopAsar;

if (require.main === module) {
  const archivePath = process.argv[2];
  if (!archivePath) fail("usage: node scripts/verify-after-pack.cjs <path-to-app.asar>");
  verifyDesktopAsar(path.resolve(archivePath));
}
