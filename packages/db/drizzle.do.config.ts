import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: "./src/do/schema.ts",
  out: "./migrations/do",
  migrations: {
    table: "__store_drizzle_migrations",
  },
});
