import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/analytics/schema.ts",
  out: "./migrations/analytics",
});
