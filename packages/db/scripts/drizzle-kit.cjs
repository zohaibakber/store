const fs = require("node:fs");
const path = require("node:path");

// drizzle-kit@1 RC dynamically imports drizzle-orm but does not declare it as
// a peer. Bun's isolated linker can therefore resolve Better Auth's 0.x copy
// from the workspace root instead of this package's 1.x copy. Expose this
// package's ORM beside the CLI for the lifetime of the command.
const packageRoot = path.resolve(__dirname, "..");
const packageNodeModules = path.join(packageRoot, "node_modules");
const kitEntry = require.resolve("drizzle-kit", { paths: [packageNodeModules] });
const kitPackage = path.dirname(kitEntry);
const kitNodeModules = path.dirname(kitPackage);
const ormLink = path.join(kitNodeModules, "drizzle-orm");
let removeOrmLink = false;

if (!fs.existsSync(ormLink)) {
  fs.symlinkSync(fs.realpathSync(path.join(packageNodeModules, "drizzle-orm")), ormLink, "dir");
  removeOrmLink = true;
}

process.on("exit", () => {
  if (removeOrmLink) fs.unlinkSync(ormLink);
});

require(path.join(kitPackage, "bin.cjs"));
