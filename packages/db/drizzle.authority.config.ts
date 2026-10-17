import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/authority/schema.ts",
  out: "./migrations/authority",
});
