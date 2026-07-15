import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env["DATABASE_URL"]?.trim();
const databaseCredentials = databaseUrl ? { dbCredentials: { url: databaseUrl } } : {};

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/remote/schema.ts",
  out: "./migrations/remote",
  migrations: {
    schema: "store_migrations",
    table: "__store_drizzle_migrations",
  },
  ...databaseCredentials,
});
