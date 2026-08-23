import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/postgres/schema.ts",
  out: "./migrations/postgres",
  migrations: {
    schema: "store_migrations",
    table: "__store_drizzle_migrations",
  },
});
