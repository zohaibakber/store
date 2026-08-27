import { execFileSync } from "node:child_process";

import { expect, test } from "vitest";

test("pnpm node-linker is hoisted so Electron Forge can package", () => {
  const linker = execFileSync("pnpm", ["config", "get", "node-linker"], {
    encoding: "utf8",
  }).trim();
  expect(linker).toBe("hoisted");
});
