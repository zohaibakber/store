import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { InventoryCommands, makeInventoryCommands } from "./commands";
import { InventoryLive, makeInventoryLive } from "./live-horizon";
import { InventoryMaintenance, makeInventoryMaintenance } from "./maintenance";
import { openInventoryDrizzle } from "./postgres";
import { InventorySnapshots, makeInventorySnapshots } from "./snapshots";

export const InventoryAuthorityLive = Layer.effectContext(
  Effect.gen(function* () {
    const db = yield* openInventoryDrizzle;
    return Context.empty().pipe(
      Context.add(InventoryCommands, makeInventoryCommands(db)),
      Context.add(InventorySnapshots, makeInventorySnapshots(db)),
      Context.add(InventoryLive, makeInventoryLive(db)),
      Context.add(InventoryMaintenance, makeInventoryMaintenance(db)),
    );
  }),
);
