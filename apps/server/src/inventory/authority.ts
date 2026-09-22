import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { InventoryCommands, InventoryCommandsUnavailable, makeInventoryCommands } from "./commands";
import { InventoryLive, InventoryLiveUnavailable, makeInventoryLive } from "./live-tickets";
import { openInventoryDrizzle } from "./postgres";
import {
  InventorySnapshots,
  InventorySnapshotsUnavailable,
  makeInventorySnapshots,
} from "./snapshots";

export const InventoryAuthorityLive = Layer.effectContext(
  Effect.gen(function* () {
    const db = yield* openInventoryDrizzle;
    return Context.empty().pipe(
      Context.add(InventoryCommands, makeInventoryCommands(db)),
      Context.add(InventorySnapshots, makeInventorySnapshots(db)),
      Context.add(InventoryLive, makeInventoryLive(db)),
    );
  }),
);

export const InventoryAuthorityUnavailable = Layer.mergeAll(
  InventoryCommandsUnavailable,
  InventorySnapshotsUnavailable,
  InventoryLiveUnavailable,
);
