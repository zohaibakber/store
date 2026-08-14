import { mkdirSync } from "node:fs";
import path from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { PersistenceConfig } from "../config";
import { libsqlLayer } from "./client";

export const databaseFile = (dataDir: string) => path.join(dataDir, "store.db");

export const nodeClientLayer = (config: PersistenceConfig) =>
  Layer.unwrap(
    Effect.sync(() => {
      mkdirSync(config.dataDir, { recursive: true });
      return libsqlLayer(`file:${databaseFile(config.dataDir)}`);
    }),
  );
