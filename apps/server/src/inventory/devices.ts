import { OrganizationDevices, type DeviceCommand } from "@store/contracts";
import type { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { answered, type AuthorityNamespace } from "./authority-client";
import { InventoryDatabaseError, type InventoryError } from "./errors";
import type { InventoryActor } from "./model";

const decodeDevices = Schema.decodeUnknownEffect(OrganizationDevices);

export interface InventoryDevicesContract<R = never> {
  readonly list: (actor: InventoryActor) => Effect.Effect<OrganizationDevices, InventoryError, R>;
  readonly command: (
    actor: InventoryActor,
    command: DeviceCommand,
  ) => Effect.Effect<OrganizationDevices, InventoryError, R>;
}

export class InventoryDevices extends Context.Service<
  InventoryDevices,
  InventoryDevicesContract<RuntimeContext>
>()("@store/server/InventoryDevices") {}

const decoded = <E, R>(devices: Effect.Effect<unknown, E, R>) =>
  Effect.flatMap(devices, (value) =>
    decodeDevices(value).pipe(
      Effect.mapError((error) =>
        InventoryDatabaseError.make({ message: error.message, cause: error }),
      ),
    ),
  );

export const makeInventoryDevices = <R, E>(
  authorities: AuthorityNamespace<R, E>,
): InventoryDevicesContract<R> => ({
  list: Effect.fn("InventoryDevices.list")(function* (actor) {
    return yield* decoded(answered(authorities.getByName(actor.organizationId).devices(actor)));
  }),
  command: Effect.fn("InventoryDevices.command")(function* (actor, command) {
    return yield* decoded(
      answered(authorities.getByName(actor.organizationId).deviceCommand(actor, command)),
    );
  }),
});
