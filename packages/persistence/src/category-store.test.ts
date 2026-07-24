import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as ManagedRuntime from "effect/ManagedRuntime";
import { expect, test } from "vitest";

import { layer } from "./index";
import { migrationsFolder, store } from "./test-support";

test("categories are created from a name, slugged and deduplicated", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-categories-"));
  let organizationId = "org-a";
  const runtime = ManagedRuntime.make(
    layer({
      dataDir: path.join(directory, "pglite"),
      migrationsFolder,
      mutationContext: () => ({ organizationId, userId: "tester", deviceId: "device-1" }),
    }),
  );

  try {
    const created = await runtime.runPromise(
      store((s) => s.createCategory({ name: "  Cough Syrups  " })),
    );
    expect(created).toMatchObject({ id: "cough-syrups", name: "Cough Syrups" });

    // The same name resolves to the existing row rather than failing.
    const again = await runtime.runPromise(
      store((s) => s.createCategory({ name: "cough syrups" })),
    );
    expect(again.id).toBe(created.id);

    const listed = await runtime.runPromise(store((s) => s.listCategories));
    expect(listed.filter((category) => category.id === "cough-syrups")).toHaveLength(1);
    // Alongside the three seeded defaults.
    expect(listed).toHaveLength(4);

    await expect(
      runtime.runPromise(store((s) => s.createCategory({ name: "   " }))),
    ).rejects.toThrow();

    // A second organization does not see it, and can reuse the same slug.
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
