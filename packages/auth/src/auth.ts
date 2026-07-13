import { electron } from "@better-auth/electron";
import { createAuthDatabase } from "@store/db/auth.database";
import * as schema from "@store/db/auth.schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, organization } from "better-auth/plugins";

const isProduction = process.env.NODE_ENV === "production";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (value) return value;
  throw new Error(`${name} must be configured.`);
};

const requiredInProduction = (name: string, developmentValue: string) => {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (!isProduction) return developmentValue;
  throw new Error(`${name} must be configured in production.`);
};

const databaseUrl = required("DATABASE_URL");
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

const database = createAuthDatabase(databaseUrl);

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
