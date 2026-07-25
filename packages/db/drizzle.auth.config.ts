import { defineConfig } from "drizzle-kit";

// Better Auth identity tables, stored in D1 (SQLite).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/remote/auth.schema.ts",
  out: "./migrations/auth",
  migrations: {
    table: "__store_drizzle_migrations",
  },
});
