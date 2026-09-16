import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/inventory/schema.ts",
  out: "./migrations/inventory",
  migrations: {
    table: "__store_drizzle_migrations",
  },
});
