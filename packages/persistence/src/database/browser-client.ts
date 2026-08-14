import type { PersistenceConfig } from "../config";
import { libsqlLayer } from "./client";

/** OPFS-backed libSQL in the browser. `dataDir` is the replica file stem, not a path. */
export const browserClientLayer = (config: PersistenceConfig) =>
  libsqlLayer(`file:${config.dataDir.replace(/[^a-zA-Z0-9_-]/g, "_")}.db`);
