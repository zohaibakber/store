import { defineConfig } from "drizzle-kit";

process.loadEnvFile(new URL("../persistence/.env", import.meta.url));

export default defineConfig({
  dialect: "turso",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env["TURSO_SYNC_URL"]!,
    authToken: process.env["TURSO_AUTH_TOKEN"]!,
  },
});
