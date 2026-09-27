const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const packageNodeModules = path.join(packageRoot, "node_modules");
const kitEntry = require.resolve("drizzle-kit", { paths: [packageNodeModules] });
const kitPackage = path.dirname(kitEntry);
const kitNodeModules = path.dirname(kitPackage);
const packageDrizzleOrm = fs.realpathSync(path.join(packageNodeModules, "drizzle-orm"));
const kitLocalDrizzleOrm = path.join(kitNodeModules, "drizzle-orm");
let unlinkPackageDrizzleOrmFromKit = false;

if (!fs.existsSync(kitLocalDrizzleOrm)) {
  fs.symlinkSync(packageDrizzleOrm, kitLocalDrizzleOrm, "dir");
  unlinkPackageDrizzleOrmFromKit = true;
}

process.on("exit", () => {
  if (unlinkPackageDrizzleOrmFromKit) fs.unlinkSync(kitLocalDrizzleOrm);
});

require(path.join(kitPackage, "bin.cjs"));
