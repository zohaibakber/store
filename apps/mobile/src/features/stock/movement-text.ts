import type { StockMovement } from "@store/contracts";

import { formatSignedCount } from "../format";

export const movementLabel = (type: StockMovement["type"]) => {
  switch (type) {
    case "stock_in":
      return "Received";
    case "sale":
      return "Sold";
    case "open_pack":
      return "Pack opened";
    case "adjustment":
      return "Adjusted";
  }
};

const signedPart = (delta: number, one: string, many: string) =>
  `${formatSignedCount(delta)} ${Math.abs(delta) === 1 ? one : many}`;

export const movementDelta = (
  movement: Pick<StockMovement, "packDelta" | "unitDelta">,
  unitsPerPack: number,
  tracksPacks: boolean,
) => {
  if (!tracksPacks || unitsPerPack <= 1) {
    return signedPart(movement.packDelta * unitsPerPack + movement.unitDelta, "unit", "units");
  }
  const parts = [
    movement.packDelta === 0 ? null : signedPart(movement.packDelta, "pack", "packs"),
    movement.unitDelta === 0 ? null : signedPart(movement.unitDelta, "unit", "units"),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? "No change" : parts.join(", ");
};
