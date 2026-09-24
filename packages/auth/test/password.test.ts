import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { Password, PasswordHash, hashPassword, verifyPassword } from "../src/auth";

describe("password hashing", () => {
  it("hashes and verifies at the Workers PBKDF2 cap", async () => {
    const password = Password.make("a-valid-password");
    const hash = await Effect.runPromise(hashPassword(password));
    expect(hash.startsWith("pbkdf2-sha256$100000$")).toBe(true);
    await expect(Effect.runPromise(verifyPassword(password, hash))).resolves.toBe(true);
    await expect(
      Effect.runPromise(verifyPassword(Password.make("a-wrong-password"), hash)),
    ).resolves.toBe(false);
  });

  it("rejects a stored hash of another length", async () => {
    const password = Password.make("a-valid-password");
    const hash = await Effect.runPromise(hashPassword(password));
    const truncated = PasswordHash.make(hash.slice(0, -4));
    const extended = PasswordHash.make(`${hash}AAAA`);
    await expect(Effect.runPromise(verifyPassword(password, truncated))).resolves.toBe(false);
    await expect(Effect.runPromise(verifyPassword(password, extended))).resolves.toBe(false);
  });
});
