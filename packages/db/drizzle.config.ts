import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env["DATABASE_URL"]?.trim();
const databaseCredentials = databaseUrl ? { dbCredentials: { url: databaseUrl } } : {};

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/auth.schema.ts", "./src/store.schema.ts", "./src/sync.schema.ts"],
  out: "./migrations",
  migrations: {
    schema: "store_migrations",
    table: "__store_drizzle_migrations",
  },
  ...databaseCredentials,
});
