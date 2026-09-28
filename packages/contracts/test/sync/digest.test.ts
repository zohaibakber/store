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
import { canonicalPayloadHash, nativeCanonicalPayloadHash } from "../../src/sync/operation-hash";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const UNICODE_IDS = ["z", "a", "é", "😀", "", "�", "日本", "A", "a:1", "á"];

describe("partition digest v2", () => {
  it("orders leaves by UTF-8 bytes, which is Postgres COLLATE C and SQLite BINARY", () => {
    const byBytes = [...UNICODE_IDS].sort((left, right) =>
      Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
    );
    expect([...UNICODE_IDS].sort(compareUtf8)).toEqual(byBytes);
    expect(sortedPartitionLeaves(UNICODE_IDS).leaves).toBe(byBytes.join("\n"));
  });

  it("follows the documented byte format", async () => {
    const report = await Effect.runPromise(
      partitionDigestOf([
        { entity: "product", entityId: "p-2", rowVersion: 3 },
        { entity: "category", entityId: "general", rowVersion: 1 },
        { entity: "product", entityId: "p-10", rowVersion: 9_007_199_254_740_991 },
      ]),
    );
    const category = sha256(`${PARTITION_DIGEST_DOMAIN}\ncategory\n1\ncategory:general:1`);
    const product = sha256(
      `${PARTITION_DIGEST_DOMAIN}\nproduct\n2\nproduct:p-10:9007199254740991\nproduct:p-2:3`,
    );
    const batch = sha256(`${PARTITION_DIGEST_DOMAIN}\nbatch\n0\n`);
    expect(report).toEqual({
      version: 2,
      count: 3,
      entities: { category, product, batch },
      digest: sha256(
        `${PARTITION_DIGEST_DOMAIN}\n3\ncategory:${category}\nproduct:${product}\nbatch:${batch}`,
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
  });

  it("hashes command payloads natively to the same value as the portable hash", async () => {
    const payload = { b: [1, { z: "é", a: null }], a: "😀" };
    expect(await Effect.runPromise(nativeCanonicalPayloadHash(payload))).toBe(
      canonicalPayloadHash(payload),
    );
  });
});
