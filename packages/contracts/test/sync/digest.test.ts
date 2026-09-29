import { createHash } from "node:crypto";

import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import {
  compareUtf8,
  divergedPartitionEntities,
  PARTITION_DIGEST_DOMAIN,
  partitionDigestOf,
  sortedPartitionLeaves,
} from "../../src/sync/digest";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const UNICODE_IDS = ["z", "a", "é", "😀", "", "�", "日本", "A", "a:1", "á"];

describe("partition digest", () => {
  it("orders leaves by UTF-8 bytes, which is Postgres COLLATE C and SQLite BINARY", () => {
    const byBytes = [...UNICODE_IDS].sort((left, right) =>
      Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
    );
    expect([...UNICODE_IDS].sort(compareUtf8)).toEqual(byBytes);
    expect(sortedPartitionLeaves(UNICODE_IDS).leaves).toBe(byBytes.join("\n"));
  });

  it("follows the documented byte format for the version 3 history digest", async () => {
    const report = await Effect.runPromise(
      partitionDigestOf([
        { entity: "category", entityId: "general", rowVersion: 1 },
        { entity: "stockMovement", entityId: "m-2", rowVersion: 1 },
        { entity: "invoice", entityId: "i-1", rowVersion: 4 },
        { entity: "invoiceItem", entityId: "ii-1", rowVersion: 1 },
        { entity: "stockMovement", entityId: "m-10", rowVersion: 1 },
      ]),
    );
    expect(PARTITION_DIGEST_DOMAIN).toBe("store.sync.partition-digest.v3");
    const entity = (name: string, leaves: ReadonlyArray<string>) =>
      sha256([PARTITION_DIGEST_DOMAIN, name, String(leaves.length), leaves.join("\n")].join("\n"));
    const entities = {
      category: entity("category", ["category:general:1"]),
      product: entity("product", []),
      batch: entity("batch", []),
      invoice: entity("invoice", ["invoice:i-1:4"]),
      invoiceItem: entity("invoiceItem", ["invoiceItem:ii-1:1"]),
      stockMovement: entity("stockMovement", ["stockMovement:m-10:1", "stockMovement:m-2:1"]),
    };
    expect(report).toEqual({
      version: 3,
      count: 5,
      entities,
      digest: sha256(
        [
          PARTITION_DIGEST_DOMAIN,
          "5",
          ...Object.entries(entities).map(([name, digest]) => `${name}:${digest}`),
        ].join("\n"),
      ),
    });
  });

  it("names the entity whose rows diverged", async () => {
    const authority = await Effect.runPromise(
      partitionDigestOf([
        { entity: "category", entityId: "general", rowVersion: 1 },
        { entity: "batch", entityId: "b-1", rowVersion: 2 },
      ]),
    );
    const local = await Effect.runPromise(
      partitionDigestOf([
        { entity: "category", entityId: "general", rowVersion: 1 },
        { entity: "batch", entityId: "b-1", rowVersion: 1 },
      ]),
    );
    expect(local.digest).not.toBe(authority.digest);
    expect(divergedPartitionEntities(local, authority)).toEqual(["batch"]);
    const withHistory = await Effect.runPromise(
      partitionDigestOf([
        { entity: "category", entityId: "general", rowVersion: 1 },
        { entity: "batch", entityId: "b-1", rowVersion: 1 },
        { entity: "invoice", entityId: "i-1", rowVersion: 1 },
      ]),
    );
    expect(divergedPartitionEntities(local, withHistory)).toEqual(["invoice"]);
  });
});
