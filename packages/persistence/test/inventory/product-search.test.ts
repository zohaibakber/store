import { expect, test } from "vitest";

import { store, type TestStoreRuntime, withTestStore } from "../lib/store";

const seed = [
  { name: "Panadol", composition: "Paracetamol 500mg" },
  { name: "Panadol Extra", composition: "Paracetamol + Caffeine" },
  { name: "Calpol", composition: "Paracetamol 120mg/5ml" },
  { name: "Disprin", composition: "Aspirin 300mg" },
  { name: "Augmentin", composition: "Amoxicillin + Clavulanic acid" },
  { name: "Brufen", composition: "Ibuprofen 400mg" },
];

const withSeededStore = async (run: (runtime: TestStoreRuntime) => Promise<void>) =>
  withTestStore(
    async ({ runtime }) => {
      for (const item of seed) {
        await runtime.runPromise(
          store((store) =>
            store.createProduct({
              name: item.name,
              categoryId: "medicine",
              aisle: null,
              composition: item.composition,
              strength: null,
              packPrice: 1000,
              unitPrice: 100,
            }),
          ),
        );
      }
      await run(runtime);
    },
    { categories: ["Medicine"] },
  );

const names = async (runtime: TestStoreRuntime, query: string) =>
  (await runtime.runPromise(store((store) => store.searchProducts({ query })))).map(
    (product) => product.name,
  );

test("phonetic misspelling 'pendal' finds Panadol (trigram alone would miss it)", async () => {
  await withSeededStore(async (runtime) => {
    const results = await names(runtime, "pendal");
    expect(results[0]).toBe("Panadol");
  });
});

test("plain typos resolve to the intended product", async () => {
  await withSeededStore(async (runtime) => {
    expect((await names(runtime, "panadl"))[0]).toBe("Panadol");
    expect((await names(runtime, "calpl"))[0]).toBe("Calpol");
    expect((await names(runtime, "augmentn"))[0]).toBe("Augmentin");
  });
});

test("composition terms surface matching products", async () => {
  await withSeededStore(async (runtime) => {
    const results = await names(runtime, "para");
    expect(results).toEqual(expect.arrayContaining(["Panadol", "Calpol"]));
    expect(results).not.toContain("Brufen");
  });
});

test("blank query returns nothing", async () => {
  await withSeededStore(async (runtime) => {
    expect(await names(runtime, "   ")).toEqual([]);
  });
});

test("hidden products are excluded from search results", async () => {
  await withSeededStore(async (runtime) => {
    expect(await names(runtime, "panadol")).toContain("Panadol Extra");

    const listed = await runtime.runPromise(store((store) => store.listProducts));
    const extra = listed.find((product) => product.name === "Panadol Extra");
    if (!extra) throw new Error("expected Panadol Extra to be seeded");

    await runtime.runPromise(
      store((store) =>
        store.updateProduct({
          id: extra.id,
          name: extra.name,
          categoryId: extra.category.id,
          aisle: extra.aisle,
          composition: extra.composition,
          strength: extra.strength,
          unitsPerPack: extra.unitsPerPack,
          packPrice: extra.packPrice,
          unitPrice: extra.unitPrice,
          visible: false,
        }),
      ),
    );

    const results = await names(runtime, "panadol");
    expect(results).not.toContain("Panadol Extra");
    expect(results).toContain("Panadol");
  });
});
