import { defineConfig } from "drizzle-kit";

// Clerk-to-store organization bindings, stored in D1 (SQLite).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/auth/schema.ts",
  out: "./migrations/auth",
  migrations: {
    table: "__store_drizzle_migrations",
  },
});
