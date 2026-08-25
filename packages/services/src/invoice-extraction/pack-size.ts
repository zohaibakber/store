const MAX_UNITS_PER_PACK = 10_000;

export type PrintedPackSize = string | number;

const isPrintedPackCount = (value: PrintedPackSize): value is number => typeof value === "number";

const asPositiveInt = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  return rounded >= 1 ? rounded : fallback;
};

export const parseUnitsPerPack = (value: PrintedPackSize, fallback = 1): number => {
  if (isPrintedPackCount(value)) return asPositiveInt(value, fallback);
  const trimmed = value.trim();
  if (!trimmed) return fallback;

  const counted = trimmed.match(/^(\d+)\s*['’]?s$/i);
  if (counted?.[1]) return asPositiveInt(Number(counted[1]), fallback);

  if (/[x×]/i.test(trimmed)) {
    const factors = trimmed
      .split(/\s*[x×]\s*/i)
      .map((part) => Number(part.replace(/[^\d]/g, "")))
      .filter((factor) => Number.isFinite(factor) && factor > 0);
    if (factors.length >= 2) {
      const product = factors.reduce((total, factor) => total * factor, 1);
      if (Number.isSafeInteger(product) && product >= 1 && product <= MAX_UNITS_PER_PACK)
        return product;
    }
  }

  return asPositiveInt(Number(trimmed.replace(/,/g, "").replace(/[^\d.-]/g, "")), fallback);
};

export const salvageUnitsPerPack = (name: string, unitsPerPack: number): number => {
  const match = name.match(/\d+(?:\s*[x×]\s*\d+)+/i);
  if (!match?.[0]) return unitsPerPack;
  const parsed = parseUnitsPerPack(match[0], unitsPerPack);
  const concatenated = Number(match[0].replace(/[^\d]/g, ""));
  if (unitsPerPack === concatenated && parsed !== concatenated) return parsed;
  return unitsPerPack;
};

export const parseMajorCurrencyToMinor = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const amount = Number(trimmed.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
};
