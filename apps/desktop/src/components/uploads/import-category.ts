import type { Category } from "@store/contracts";

export const DEFAULT_IMPORT_CATEGORY_NAME = "General";

export type ImportCategory =
  | { readonly _tag: "Existing"; readonly id: Category["id"] }
  | { readonly _tag: "New"; readonly name: string };

const isDefault = (category: Category) =>
  category.name.trim().toLocaleLowerCase() === DEFAULT_IMPORT_CATEGORY_NAME.toLocaleLowerCase();

export const importCategoryOf = (
  categories: ReadonlyArray<Category>,
  chosenId: string | null,
  newName: string,
): ImportCategory => {
  const existing =
    categories.find((category) => category.id === chosenId) ??
    categories.find(isDefault) ??
    categories[0];
  return existing === undefined
    ? { _tag: "New", name: newName }
    : { _tag: "Existing", id: existing.id };
};
