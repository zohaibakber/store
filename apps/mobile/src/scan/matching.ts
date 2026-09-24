import { matchCatalogProducts, type SearchableProduct } from "@store/inventory-react";

import { textContains } from "./fields";

export type CatalogCandidate = SearchableProduct & { readonly unitsPerPack: number };

export type ScanIdentity = {
  readonly name: string | null;
  readonly composition: string | null;
  readonly strength: string | null;
};

const clean = (value: string | null): string => (value ?? "").replace(/\s+/g, " ").trim();

export const brandQuery = (identity: ScanIdentity): string => {
  const [brand] = clean(identity.name).split(" ");
  return brand ?? "";
};

const strengthMatches = (candidate: CatalogCandidate, strength: string): boolean =>
  strength !== "" && textContains(`${candidate.strength ?? ""} ${candidate.name}`, strength);

export const pickCatalogMatch = <Candidate extends CatalogCandidate>(
  products: Iterable<Candidate>,
  identity: ScanIdentity,
): Candidate | null => {
  const pool = [...products];
  const name = clean(identity.name);
  const strength = clean(identity.strength);
  const composition = clean(identity.composition);
  if (name) {
    const exact = matchCatalogProducts(pool, name, 5);
    const exactWithStrength = exact.find((candidate) => strengthMatches(candidate, strength));
    if (exactWithStrength) return exactWithStrength;
    if (exact.length > 0 && (strength === "" || exact.length === 1)) return exact[0] ?? null;
    const brand = matchCatalogProducts(pool, brandQuery(identity), 10);
    const brandWithStrength = brand.find((candidate) => strengthMatches(candidate, strength));
    if (brandWithStrength) return brandWithStrength;
  }
  if (composition && strength) {
    const generic = matchCatalogProducts(pool, composition, 10);
    return generic.find((candidate) => strengthMatches(candidate, strength)) ?? null;
  }
  return null;
};
