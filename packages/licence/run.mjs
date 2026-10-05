import { fileURLToPath } from "node:url";

import { runnerImport } from "vite";

if (process.argv[2] === "--") process.argv.splice(2, 1);

await runnerImport(fileURLToPath(new URL("./src/cli.ts", import.meta.url)), {
  configFile: false,
  logLevel: "error",
});
