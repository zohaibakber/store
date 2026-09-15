import type { ProductId } from "@store/contracts";

export const sameProduct = (
  line: { readonly name: string; readonly unitsPerPack: number },
  product: { readonly name: string; readonly unitsPerPack: number },
) =>
  product.name.trim().toLocaleLowerCase() === line.name.trim().toLocaleLowerCase() &&
  product.unitsPerPack === line.unitsPerPack;

export type ImportProductMatch =
  | { readonly _tag: "none" }
  | { readonly _tag: "one"; readonly id: ProductId }
  | { readonly _tag: "many" };

export const ambiguousImportProductMessage = (name: string, unitsPerPack: number) =>
  `Multiple products are named “${name.trim()}” with ${unitsPerPack} units per pack. Choose which one to restock.`;

export const importProductMatch = (
  line: { readonly name: string; readonly unitsPerPack: number },
  products: ReadonlyArray<{
    readonly id: ProductId;
    readonly name: string;
    readonly unitsPerPack: number;
  }>,
): ImportProductMatch => {
  const matches = products.filter((product) => sameProduct(line, product));
  if (matches.length > 1) return { _tag: "many" };
  const product = matches[0];
  if (product) return { _tag: "one", id: product.id };
  return { _tag: "none" };
};
