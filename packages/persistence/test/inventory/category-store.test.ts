import { expect, test } from "vitest";

import { store, withTestStore } from "../lib/store";

test("categories are created from a name, slugged and deduplicated", async () => {
  let organizationId = "org-a";
  await withTestStore(
    async ({ runtime }) => {
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
    },
    {
      mutationContext: () => ({ organizationId, userId: "tester", deviceId: "device-1" }),
    },
  );
});
