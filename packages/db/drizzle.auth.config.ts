import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/auth/schema.ts",
  out: "./migrations/auth",
  migrations: {
    table: "__store_drizzle_migrations",
  },
});
