import { execFileSync } from "node:child_process";

import { expect, test } from "vitest";

const pnpmConfig = (key: string) =>
  execFileSync("pnpm", ["config", "get", key], { encoding: "utf8" }).trim();

test("pnpm hoist config satisfies Electron Forge packaging preflight", () => {
  const hoistPattern = pnpmConfig("hoist-pattern");
  const publicHoistPattern = pnpmConfig("public-hoist-pattern");
  const nodeLinker = pnpmConfig("node-linker");
  const forgeAcceptsPnpm =
    hoistPattern !== "undefined" || publicHoistPattern !== "undefined" || nodeLinker === "hoisted";
  expect(forgeAcceptsPnpm).toBe(true);
});
