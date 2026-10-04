import { createHash } from "node:crypto";

import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { compareUtf8, sortedPartitionLeaves } from "../../src/sync/digest";
import { canonicalPayloadHash, sha256Hex } from "../../src/sync/operation-hash";

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
});

describe("operation hash", () => {
  it("hashes the canonical JSON of a payload to a fixed SHA-256 vector", async () => {
    expect(canonicalPayloadHash({ b: 1, a: [2, { z: null, y: "é", u: undefined }] })).toBe(
      "ec16434fd977b8278695259ef46f4abb10fc5095b65acc000e1987bed40a04f9",
    );
    expect(canonicalPayloadHash(undefined)).toBe(
      "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b",
    );
    expect(await Effect.runPromise(sha256Hex("é😀"))).toBe(sha256("é😀"));
  });
});
