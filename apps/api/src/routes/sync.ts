import { Hono, type Context } from "hono";
import type { AppEnv } from "../auth-client";
import { publicError } from "../errors";
import type { SyncCredentials } from "../turso";

export const syncRoute = (
  issueSyncCredentials: (organizationId: string) => Promise<SyncCredentials>,
) => {
  const credentials = async (c: Context<AppEnv>) => {
    try {
      return c.json(await issueSyncCredentials(c.get("organizationId")));
    } catch {
      return c.json(
        publicError(
          "SYNC_CREDENTIALS_UNAVAILABLE",
          "Sync credentials are temporarily unavailable.",
        ),
        503,
      );
    }
  };
  return new Hono<AppEnv>().get("/credentials", credentials).post("/credentials", credentials);
};
