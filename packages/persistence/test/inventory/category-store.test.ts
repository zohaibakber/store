import { expect, test } from "vitest";

import { store, withTestStore } from "../lib/store";

const workspaceFor = (organizationId: string) => ({
  organizationId,
  userId: "tester",
  deviceId: "device-1",
});

test("categories are created from a name, slugged and deduplicated", async () => {
  await withTestStore(
    async ({ runtime, makeRuntime }) => {
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
      expect(listed).toHaveLength(2);

      await expect(
        runtime.runPromise(store((s) => s.createCategory({ name: "   " }))),
      ).rejects.toThrow();

      // The same database, opened as a different organization: categories are
      // scoped to the workspace, so the slug is free to be reused there.
      const otherOrganization = makeRuntime({ workspace: workspaceFor("org-b") });
      const other = await otherOrganization.runPromise(store((s) => s.listCategories));
      expect(other.some((category) => category.id === "cough-syrups")).toBe(false);
      const reused = await otherOrganization.runPromise(
        store((s) => s.createCategory({ name: "Cough Syrups" })),
      );
      expect(reused.id).toBe("cough-syrups");
    },
    { workspace: workspaceFor("org-a") },
  );
});
