// Matches the former PostgreSQL ranking; verify weight changes against the search corpus.
import { doubleMetaphone } from "double-metaphone";

export interface RankableProduct {
  readonly name: string;
  readonly composition: string | null;
}

export const normalize = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

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

export const similarity = (a: string, b: string): number => {
  const left = trigrams(a);
  const right = trigrams(b);
  const shared = intersectionSize(left, right);
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
};

// PostgreSQL word_similarity divides by the first argument's trigram count.
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

// PostgreSQL truncates dmetaphone to four characters.
export const dmetaphone = (value: string): string => {
  const letters = normalize(value)
    .replace(/[^a-z0-9 ]/g, " ")
    .trim();
  if (letters.length === 0) return "";
  return doubleMetaphone(letters)[0].slice(0, 4);
};

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

    // Avoid Levenshtein when a distance of two is impossible.
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
