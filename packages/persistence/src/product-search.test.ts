import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { expect, test } from "vitest";
import { layer } from "./index";
import { migrationsFolder, store } from "./test-support";

const seed = [
  { name: "Panadol", composition: "Paracetamol 500mg" },
  { name: "Panadol Extra", composition: "Paracetamol + Caffeine" },
  { name: "Calpol", composition: "Paracetamol 120mg/5ml" },
  { name: "Disprin", composition: "Aspirin 300mg" },
  { name: "Augmentin", composition: "Amoxicillin + Clavulanic acid" },
  { name: "Brufen", composition: "Ibuprofen 400mg" },
];

const withStore = async (run: (runtime: ReturnType<typeof makeRuntime>) => Promise<void>) => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-search-"));
  const runtime = makeRuntime(directory);
  try {
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
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
};

const makeRuntime = (directory: string) =>
  ManagedRuntime.make(layer({ dataDir: path.join(directory, "pglite"), migrationsFolder }));

const names = async (runtime: ReturnType<typeof makeRuntime>, query: string) =>
  (await runtime.runPromise(store((store) => store.searchProducts({ query })))).map(
    (product) => product.name,
  );

test("phonetic misspelling 'pendal' finds Panadol (trigram alone would miss it)", async () => {
  await withStore(async (runtime) => {
    const results = await names(runtime, "pendal");
    expect(results[0]).toBe("Panadol");
  });
});

test("plain typos resolve to the intended product", async () => {
  await withStore(async (runtime) => {
    expect((await names(runtime, "panadl"))[0]).toBe("Panadol");
    expect((await names(runtime, "calpl"))[0]).toBe("Calpol");
    expect((await names(runtime, "augmentn"))[0]).toBe("Augmentin");
  });
});

test("composition terms surface matching products", async () => {
  await withStore(async (runtime) => {
    const results = await names(runtime, "para");
    expect(results).toEqual(expect.arrayContaining(["Panadol", "Calpol"]));
    expect(results).not.toContain("Brufen");
  });
});

test("blank query returns nothing", async () => {
  await withStore(async (runtime) => {
    expect(await names(runtime, "   ")).toEqual([]);
  });
});
