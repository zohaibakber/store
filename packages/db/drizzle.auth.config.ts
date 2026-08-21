import { defineConfig } from "drizzle-kit";

// First-party users, organizations, credentials, and refresh sessions in D1.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/auth/schema.ts",
  out: "./migrations/auth",
  migrations: {
    table: "__store_drizzle_migrations",
  },
});
