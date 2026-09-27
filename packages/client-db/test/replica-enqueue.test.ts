import { SyncCommandEnvelope } from "@store/contracts";
import { lastUnitBuyerACommand, lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { touchedEntitiesForCommand, touchedKeysForCommand } from "../src/replica/enqueue";

describe("touchedKeysForCommand", () => {
  it("names an invoice command with the entity:id key packages/sync publishes", () => {
    expect(touchedKeysForCommand(lastUnitBuyerAEnvelope)).toEqual([
      `invoice:${lastUnitBuyerACommand.invoiceId}`,
    ]);
  });

  it("names each catalog write with its entity and id", () => {
    const envelope = Schema.decodeUnknownSync(SyncCommandEnvelope)({
      ...Schema.encodeSync(SyncCommandEnvelope)(lastUnitBuyerAEnvelope),
      command: {
        _tag: "catalogWrite",
        payload: {
          commandId: "op-1",
          deviceId: "device-1",
          occurredAt: 1,
          writes: [
            {
              entity: "category",
              action: "delete",
              id: "category-1",
              expectedRowVersion: 2,
            },
            {
              entity: "product",
              action: "delete",
              id: "product-1",
              expectedRowVersion: 3,
            },
          ],
        },
      },
    });
    expect(touchedKeysForCommand(envelope)).toEqual(["category:category-1", "product:product-1"]);
    expect(touchedEntitiesForCommand(envelope)).toEqual(["category", "product"]);
  });
});
