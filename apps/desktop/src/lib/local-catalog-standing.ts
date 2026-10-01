export type LocalCatalogStanding = "empty" | "stocked";

export type LocalCatalogReport =
  | { readonly _tag: LocalCatalogStanding }
  | { readonly _tag: "unknown" };

export const standingFromRowCount = (rows: number): LocalCatalogStanding =>
  rows > 0 ? "stocked" : "empty";

export const localCatalogReport = (standing: LocalCatalogStanding): LocalCatalogReport => ({
  _tag: standing,
});

export const UNKNOWN_CATALOG: LocalCatalogReport = { _tag: "unknown" };
