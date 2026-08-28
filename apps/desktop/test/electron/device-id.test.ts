import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadDeviceId } from "../../electron/device-id";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("desktop device id", () => {
  it("replaces invalid persisted state with a valid stable identifier", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tabaaq-device-id-"));
    directories.push(directory);
    const file = path.join(directory, "device-id");
    await writeFile(file, "   ");

    const created = await loadDeviceId(directory);

    expect(created).toMatch(/^[0-9a-f-]{36}$/u);
    expect(await readFile(file, "utf8")).toBe(created);
    expect(await loadDeviceId(directory)).toBe(created);
  });
});
