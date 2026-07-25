import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as ManagedRuntime from "effect/ManagedRuntime";
import { expect, test } from "vitest";

import { layer } from "../../src/index";
import { migrationsFolder, store } from "../lib/store";

test("categories are created from a name, slugged and deduplicated", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-categories-"));
  let organizationId = "org-a";
  const runtime = ManagedRuntime.make(
    layer({
      dataDir: path.join(directory, "data"),
      migrationsFolder,
      mutationContext: () => ({ organizationId, userId: "tester", deviceId: "device-1" }),
    }),
  );

  try {
    const created = await runtime.runPromise(
      store((s) => s.createCategory({ name: "  Cough Syrups  " })),
    );
    expect(created).toMatchObject({ id: "cough-syrups", name: "Cough Syrups" });

    const again = await runtime.runPromise(
      store((s) => s.createCategory({ name: "cough syrups" })),
    );
    expect(again.id).toBe(created.id);

    const listed = await runtime.runPromise(store((s) => s.listCategories));
    expect(listed.filter((category) => category.id === "cough-syrups")).toHaveLength(1);
    expect(listed).toHaveLength(4);

    await expect(
      runtime.runPromise(store((s) => s.createCategory({ name: "   " }))),
    ).rejects.toThrow();

    organizationId = "org-b";
    const other = await runtime.runPromise(store((s) => s.listCategories));
    expect(other.some((category) => category.id === "cough-syrups")).toBe(false);
    const reused = await runtime.runPromise(
      store((s) => s.createCategory({ name: "Cough Syrups" })),
    );
    expect(reused.id).toBe("cough-syrups");
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
