import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/local/schema.ts",
  out: "./migrations/local",
  migrations: {
    schema: "store_migrations",
    table: "__store_drizzle_migrations",
  },
});
