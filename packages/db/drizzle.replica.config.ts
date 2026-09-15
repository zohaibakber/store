import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/replica/schema.ts",
  out: "./migrations/replica",
  migrations: {
    table: "__store_drizzle_migrations",
  },
});
