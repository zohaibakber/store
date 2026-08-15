import { defineConfig } from "drizzle-kit";

// Identity tables, stored in D1 (SQLite). Better Auth tables are retained so
// Clerk orgs can bind to existing Durable Object names.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/auth/schema.ts",
  out: "./migrations/auth",
  migrations: {
    table: "__store_drizzle_migrations",
  },
});
