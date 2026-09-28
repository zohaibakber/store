import {
  ReplicaClientSequence,
  SyncEpoch,
  SyncSubmitCommandRequest,
  type CatalogRowWrite,
} from "@store/contracts";
import {
  decodeBatchId,
  decodeCategoryId,
  decodeOrganizationId,
  decodeProductId,
} from "@store/contracts/ids";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import { lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { test } from "vitest";

import { MAX_SUBMIT_BODY_BYTES } from "../../src/inventory/commands";

const importRows = (count: number): Array<CatalogRowWrite> =>
  Array.from({ length: count }, (_, index) =>
    index % 2 === 0
      ? {
          entity: "product",
          action: "upsert",
          id: decodeProductId(`product-${index}`),
          expectedRowVersion: null,
          row: {
            name: `Paracetamol 500mg tablets ${index}`,
            categoryId: decodeCategoryId("general"),
            aisle: "A-3",
            composition: "Paracetamol",
            strength: "500mg",
            unitsPerPack: 10,
            purchasePrice: 1_200,
            retailPrice: 1_500,
            unitPrice: 150,
            visible: true,
          },
        }
      : {
          entity: "batch",
          action: "upsert",
          id: decodeBatchId(`batch-${index}`),
          expectedRowVersion: null,
          movementId: `movement-${index}`,
          note: null,
          row: {
            productId: decodeProductId(`product-${index - 1}`),
            batchNumber: `LOT-${index}`,
            expiresAt: 1_800_000_000_000,
            packQuantity: 12,
            unitQuantity: 4,
          },
        },
  );

const importBody = (rows: number) => {
  const command = {
    _tag: "catalogWrite" as const,
    payload: {
      commandId: `import-${rows}`,
      deviceId: "replica-a",
      occurredAt: 1_700_000_000_000,
      writes: importRows(rows),
    },
  };
  return new TextEncoder().encode(
    JSON.stringify({
      organizationId: decodeOrganizationId("org-1"),
      epoch: SyncEpoch.make("1"),
      replicaId: "replica-a",
      clientSequence: ReplicaClientSequence.make("1"),
      operationId: command.payload.commandId,
      payloadHash: canonicalPayloadHash(command),
      command,
      afterCommitSequence: "0",
    }),
  );
};

const utf8 = new TextDecoder();
const bodyCap = MAX_SUBMIT_BODY_BYTES;
const decodeRequest = Schema.decodeUnknownEffect(SyncSubmitCommandRequest);

const typedSubmitBody = (bytes: Uint8Array) =>
  JSON.stringify(Effect.runSync(decodeRequest(JSON.parse(utf8.decode(bytes)))));

const rawSubmitBody = (bytes: Uint8Array) =>
  bytes.byteLength > bodyCap ? undefined : utf8.decode(bytes);

const bodies = {
  "one-line invoice": new TextEncoder().encode(JSON.stringify(lastUnitBuyerAEnvelope)),
  "500-row import": importBody(500),
  "1000-row import": importBody(1_000),
};

for (const [name, bytes] of Object.entries(bodies)) {
  test(`submit body CPU, ${name} (${bytes.byteLength} bytes)`, async ({ bench }) => {
    await bench.compare(
      bench("typed: JSON.parse + Schema decode + JSON.stringify", () => {
        typedSubmitBody(bytes);
      }),
      bench("raw: byte cap + UTF-8 decode", () => {
        rawSubmitBody(bytes);
      }),
    );
  });
}
