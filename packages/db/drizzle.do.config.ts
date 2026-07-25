import { defineConfig } from "drizzle-kit";

// Schema for the per-organization Durable Object store. SQLite, same dialect as
// the client, so `shared/store.schema.ts` is shared by both.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/do/schema.ts",
  out: "./migrations/do",
  migrations: {
    table: "__store_drizzle_migrations",
  },
});
