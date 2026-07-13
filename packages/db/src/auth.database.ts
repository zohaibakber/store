import { drizzle } from "drizzle-orm/neon-http";
import { relations } from "./relations";

export const createAuthDatabase = (databaseUrl: string) => drizzle(databaseUrl, { relations });
