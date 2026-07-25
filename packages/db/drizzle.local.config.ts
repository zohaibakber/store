import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/local/schema.ts",
  out: "./migrations/local",
  migrations: {
    // No `schema`: SQLite has no schema namespaces.
    table: "__store_drizzle_migrations",
  },
});
