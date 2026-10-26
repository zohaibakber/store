import { describe, expect, it } from "@effect/vitest";
import { SqliteReplica } from "@store/sync/sql-client";
import { layerNodeSqliteReplica } from "@store/sync/sqlite";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { readSnapshotSummary, snapshotRunnerFromHandle } from "../src/replica/snapshot-read";
import type { InventorySubsetSummarySpec } from "../src/replica/subset-spec";

const summarize = (spec: InventorySubsetSummarySpec) =>
  Effect.exit(
    SqliteReplica.use((handle) =>
      readSnapshotSummary(snapshotRunnerFromHandle(handle), "summary", spec),
    ).pipe(Effect.provide(layerNodeSqliteReplica(":memory:"), { local: true })),
  );

describe("SQLite subset summary", () => {
  it.effect("rejects columns outside the allowlists", () =>
    Effect.gen(function* () {
      expect(
        Exit.isFailure(yield* summarize({ source: "products", distinct: ["retailPrice"] })),
      ).toBe(true);
      expect(
        Exit.isFailure(
          yield* summarize({
            source: "products",
            where: { _tag: "compare", column: "retailPrice", op: "eq", value: 1 },
            distinct: [],
          }),
        ),
      ).toBe(true);
    }),
  );
});
