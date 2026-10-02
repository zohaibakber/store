import { formatCount, formatNumber, pluralize } from "@/lib/format";

export const formatStock = (units: number, unitsPerPack: number, tracksPacks: boolean) => {
  if (!tracksPacks || unitsPerPack <= 1) return formatCount(units, "unit");
  const packs = Math.floor(units / unitsPerPack);
  const loose = units - packs * unitsPerPack;
  if (loose === 0) return formatCount(packs, "pack");
  if (packs === 0) return formatCount(loose, "unit");
  return `${formatCount(packs, "pack")} + ${formatCount(loose, "unit")}`;
};

export const formatBatchQuantity = (packs: number, units: number, tracksPacks: boolean) => {
  if (!tracksPacks) return formatCount(units, "unit");
  if (units === 0) return formatCount(packs, "pack");
  if (packs === 0) return formatCount(units, "unit");
  return `${formatCount(packs, "pack")} + ${formatCount(units, "unit")}`;
};

const signed = (value: number, singular: string) =>
  `${value > 0 ? "+" : "−"}${formatNumber(Math.abs(value))} ${pluralize(Math.abs(value), singular)}`;

export const formatDelta = (packDelta: number, unitDelta: number) => {
  const parts = [
    ...(packDelta === 0 ? [] : [signed(packDelta, "pack")]),
    ...(unitDelta === 0 ? [] : [signed(unitDelta, "unit")]),
  ];
  return parts.length === 0 ? "0" : parts.join(", ");
};
