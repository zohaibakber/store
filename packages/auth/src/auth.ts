import { electron } from "@better-auth/electron";
import { neon } from "@neondatabase/serverless";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, organization } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./auth-schema";

const isProduction = process.env.NODE_ENV === "production";

const requiredInProduction = (name: string, developmentValue: string) => {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (!isProduction) return developmentValue;
  throw new Error(`${name} must be configured in production.`);
};

const databaseUrl = requiredInProduction(
  "DATABASE_URL",
  "postgres://user:password@localhost:5432/store_auth_dev",
);
const secret = requiredInProduction(
  "BETTER_AUTH_SECRET",
  "development-only-store-auth-secret-change-before-deploying",
);
const baseURL = requiredInProduction("BETTER_AUTH_URL", "http://localhost:8787");
const browserOrigins = (process.env.AUTH_TRUSTED_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const electronProtocol = process.env.ELECTRON_PROTOCOL?.trim() || "com.tabaaq.desktop";

const client = neon(databaseUrl);
const database = drizzle(client, { schema });

export const trustedOrigins = [...browserOrigins, `${electronProtocol}:/`];

export const auth = betterAuth({
  appName: "Store",
  baseURL,
  secret,
  database: drizzleAdapter(database, { provider: "pg", schema }),
  emailAndPassword: { enabled: true },
  trustedOrigins,
  plugins: [
    bearer({ requireSignature: true }),
    organization({
      creatorRole: "owner",
      membershipLimit: 100,
    }),
    electron({ clientID: "store-electron" }),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
