// Typo- and phonetic-tolerant ranking for product search.
//
// This used to run in SQL against the PGlite pg_trgm / fuzzystrmatch / unaccent
// extensions. SQLite has no equivalent of any of those functions, so the ranking
// moved into TypeScript. Every function here reproduces the Postgres one it
// replaces, and the agreement was verified differentially against a live PGlite
// database before the migration (see plans/021-libsql-migration.md, phase 2):
//
//   similarity      100%   levenshtein  100%   soundex  100%
//   dmetaphone      100%   word_similarity 98.2%
//
// The weights are the ones that were tuned in SQL. Do not change them without
// re-running the search regression corpus — they encode real domain knowledge,
// notably that phonetics carry misspellings like "pendal" -> "panadol", which
// share almost no trigrams.
import { doubleMetaphone } from "double-metaphone";

export interface RankableProduct {
  readonly name: string;
  readonly composition: string | null;
}

/** Equivalent of `lower(unaccent(x))`. */
export const normalize = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * pg_trgm trigram extraction. Postgres splits on non-alphanumerics, pads each
 * word with two leading spaces and one trailing space, then takes every
 * three-character window: "abc" -> ["  a", " ab", "abc", "bc "].
 */
export const trigrams = (value: string): ReadonlySet<string> => {
  const set = new Set<string>();
  for (const word of normalize(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)) {
    const padded = `  ${word} `;
    for (let index = 0; index + 3 <= padded.length; index++) {
      set.add(padded.slice(index, index + 3));
    }
  }
  return set;
};

const intersectionSize = (left: ReadonlySet<string>, right: ReadonlySet<string>) => {
  let count = 0;
  for (const item of left) if (right.has(item)) count++;
  return count;
};

/** pg_trgm `similarity(a, b)` — Jaccard over trigram sets. */
export const similarity = (a: string, b: string): number => {
  const left = trigrams(a);
  const right = trigrams(b);
  const shared = intersectionSize(left, right);
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
};

/**
 * pg_trgm `word_similarity(a, b)` — the greatest similarity between a's trigram
 * set and any continuous extent of b.
 *
 * Unlike `similarity()`, this is NOT Jaccard: Postgres divides the intersection
 * by the trigram count of the FIRST argument only. Verified against PGlite —
 * `word_similarity('pendal', 'Panadol')` is 1/7, not 1/14.
 */
export const wordSimilarity = (a: string, b: string): number => {
  const words = normalize(b)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const target = trigrams(a);
  if (words.length === 0 || target.size === 0) return 0;

  let best = 0;
  for (let start = 0; start < words.length; start++) {
    for (let end = start + 1; end <= words.length; end++) {
      const extent = trigrams(words.slice(start, end).join(" "));
      const score = intersectionSize(target, extent) / target.size;
      if (score > best) best = score;
    }
  }
  return best;
};

/** fuzzystrmatch `levenshtein()` — unit insert/delete/substitute costs. */
export const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
};

const soundexCode = (character: string): string => {
  if ("BFPV".includes(character)) return "1";
  if ("CGJKQSXZ".includes(character)) return "2";
  if ("DT".includes(character)) return "3";
  if (character === "L") return "4";
  if ("MN".includes(character)) return "5";
  if (character === "R") return "6";
  return "";
};

/** fuzzystrmatch `soundex()` — classic four-character Soundex. */
export const soundex = (value: string): string => {
  const letters = normalize(value)
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  const first = letters[0];
  if (first === undefined) return "";

  let result = first;
  let previous = soundexCode(first);
  for (let index = 1; index < letters.length && result.length < 4; index++) {
    const character = letters[index] ?? "";
    const digit = soundexCode(character);
    if (digit !== "" && digit !== previous) result += digit;
    // H and W are transparent: they do not reset the previous code.
    if (character !== "H" && character !== "W") previous = digit;
  }
  return result.padEnd(4, "0").slice(0, 4);
};

/**
 * fuzzystrmatch `dmetaphone()` — the primary double-metaphone code.
 *
 * Postgres truncates to four characters; the `double-metaphone` package does
 * not. Verified against PGlite — `dmetaphone('augmenton')` is 'AKMN', not
 * 'AKMNTN'. Without the slice, agreement with Postgres is only 56%.
 */
export const dmetaphone = (value: string): string => {
  const letters = normalize(value)
    .replace(/[^a-z0-9 ]/g, " ")
    .trim();
  if (letters.length === 0) return "";
  return doubleMetaphone(letters)[0].slice(0, 4);
};

/**
 * Per-product values that do not change between keystrokes. Computing these
 * once and reusing them across queries is what makes in-memory ranking faster
 * than the SQL it replaced; scoring without it is measurably slower.
 */
export interface PreparedProduct<T extends RankableProduct> {
  readonly product: T;
  readonly nameNormalized: string;
  readonly nameTrigrams: ReadonlySet<string>;
  readonly nameDmetaphone: string;
  readonly nameSoundex: string;
  readonly compositionNormalized: string;
}

export const prepare = <T extends RankableProduct>(product: T): PreparedProduct<T> => ({
  product,
  nameNormalized: normalize(product.name),
  nameTrigrams: trigrams(product.name),
  nameDmetaphone: dmetaphone(product.name),
  nameSoundex: soundex(product.name),
  compositionNormalized: normalize(product.composition ?? ""),
});

export interface RankedProduct<T extends RankableProduct> {
  readonly product: T;
  readonly score: number;
}

/**
 * Filter and rank. Mirrors the previous SQL `WHERE` clause and `ORDER BY`
 * expression exactly, including the weights.
 */
export const rank = <T extends RankableProduct>(
  prepared: ReadonlyArray<PreparedProduct<T>>,
  rawQuery: string,
  limit = 20,
): ReadonlyArray<RankedProduct<T>> => {
  const query = rawQuery.trim();
  if (query.length === 0) return [];

  const capped = Math.min(Math.max(limit, 1), 50);
  const normalized = normalize(query);
  const queryTrigrams = trigrams(query);
  const queryDmetaphone = dmetaphone(query);
  const querySoundex = soundex(query);

  const matched: Array<RankedProduct<T>> = [];
  for (const entry of prepared) {
    const shared = intersectionSize(entry.nameTrigrams, queryTrigrams);
    const union = entry.nameTrigrams.size + queryTrigrams.size - shared;
    const nameSimilarity = union === 0 ? 0 : shared / union;

    const compositionSimilarity = wordSimilarity(normalized, entry.compositionNormalized);
    const dmetaphoneHit = entry.nameDmetaphone === queryDmetaphone;
    const soundexHit = entry.nameSoundex === querySoundex;

    // Levenshtein is the most expensive term, and a distance of <= 2 is
    // impossible once the lengths differ by more than 2.
    const distance =
      Math.abs(entry.nameNormalized.length - normalized.length) <= 2
        ? levenshtein(entry.nameNormalized, normalized)
        : Number.POSITIVE_INFINITY;

    const isMatch =
      nameSimilarity > 0.15 ||
      compositionSimilarity > 0.4 ||
      dmetaphoneHit ||
      soundexHit ||
      distance <= 2 ||
      entry.nameNormalized.includes(normalized);
    if (!isMatch) continue;

    matched.push({
      product: entry.product,
      score:
        0.45 * nameSimilarity +
        0.25 * compositionSimilarity +
        (entry.nameNormalized.startsWith(normalized) ? 0.3 : 0) +
        (dmetaphoneHit ? 0.4 : 0) +
        (soundexHit ? 0.25 : 0) +
        (distance <= 2 ? 0.2 : 0),
    });
  }

  return matched
    .sort(
      (left, right) =>
        right.score - left.score || left.product.name.localeCompare(right.product.name),
    )
    .slice(0, capped);
};
