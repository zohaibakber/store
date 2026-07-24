import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const databaseEnvUrl = new URL("../../../packages/db/.env", import.meta.url);
const databaseEnv = await readFile(databaseEnvUrl, "utf8");
const databaseUrlLine = databaseEnv.split(/\r?\n/).find((line) => line.startsWith("DATABASE_URL="));

if (!databaseUrlLine) {
  throw new Error(`DATABASE_URL is missing from ${fileURLToPath(databaseEnvUrl)}`);
}

const databaseUrl = databaseUrlLine
  .slice("DATABASE_URL=".length)
  .trim()
  .replace(/^(["'])(.*)\1$/, "$2");

if (!databaseUrl) {
  throw new Error(`DATABASE_URL is empty in ${fileURLToPath(databaseEnvUrl)}`);
}

const wrangler = spawn("wrangler", ["dev", "--port", "8787"], {
  env: {
    ...process.env,
    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: databaseUrl,
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});

wrangler.on("error", (error) => {
  console.error("Could not start the local Worker.", error);
  process.exitCode = 1;
});

wrangler.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
