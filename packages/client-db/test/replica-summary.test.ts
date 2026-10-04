import { SqliteReplica } from "@store/sync/sql-client";
import { layerNodeSqliteReplica } from "@store/sync/sqlite";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { describe, expect, it } from "vitest";

import { readSnapshotSummary, snapshotRunnerFromHandle } from "../src/replica/snapshot-read";
import type { InventorySubsetSummarySpec } from "../src/replica/subset-spec";

const summarize = (spec: InventorySubsetSummarySpec) =>
  Effect.runPromiseExit(
    SqliteReplica.use((handle) =>
      readSnapshotSummary(snapshotRunnerFromHandle(handle), "summary", spec),
    ).pipe(Effect.provide(layerNodeSqliteReplica(":memory:"), { local: true })),
  );

describe("SQLite subset summary", () => {
  it("rejects columns outside the allowlists", async () => {
    expect(Exit.isFailure(await summarize({ source: "products", distinct: ["retailPrice"] }))).toBe(
      true,
    );
    expect(
      Exit.isFailure(
        await summarize({
          source: "products",
          where: { _tag: "compare", column: "retailPrice", op: "eq", value: 1 },
          distinct: [],
        }),
      ),
    ).toBe(true);
  });
});
