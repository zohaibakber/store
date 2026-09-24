import {
  decodeBatchId,
  decodeInvoiceId,
  decodeInvoiceItemId,
  decodeOrganizationId,
  decodeProductId,
} from "../../ids";
import type { IssueInvoiceCommand } from "../../store/schema";
import { canonicalPayloadHash } from "../operation-hash";
import { ReplicaClientSequence, type SyncCommandEnvelope, SyncEpoch } from "../protocol";

export const LAST_UNIT_ORGANIZATION_ID = decodeOrganizationId("org-1");
export const LAST_UNIT_REPLICA_A = "replica-a";
export const LAST_UNIT_REPLICA_B = "replica-b";
export const LAST_UNIT_EPOCH = SyncEpoch.make("1");
export const LAST_UNIT_PRODUCT_ID = decodeProductId("product-1");
export const LAST_UNIT_BATCH_ID = decodeBatchId("batch-1");

const issueInvoice = (input: {
  readonly commandId: string;
  readonly replicaDeviceId: string;
  readonly invoiceItemId: string;
  readonly saleMovementId: string;
}): IssueInvoiceCommand => ({
  commandId: input.commandId,
  deviceId: input.replicaDeviceId,
  occurredAt: 1_700_000_000_000,
  invoiceId: decodeInvoiceId(input.commandId),
  invoiceNumber: 1,
  input: {
    customerName: null,
    items: [
      {
        productId: LAST_UNIT_PRODUCT_ID,
        batchId: LAST_UNIT_BATCH_ID,
        quantity: 1,
        quantityType: "unit",
        salePrice: 100,
      },
    ],
  },
  allocations: [
    {
      invoiceItemId: decodeInvoiceItemId(input.invoiceItemId),
      saleMovementId: input.saleMovementId,
      openPackMovementId: null,
      productId: LAST_UNIT_PRODUCT_ID,
      batchId: LAST_UNIT_BATCH_ID,
      quantity: 1,
      quantityType: "unit",
      salePrice: 100,
      packsOpened: 0,
    },
  ],
});

export const lastUnitBuyerACommand = issueInvoice({
  commandId: "sale-a",
  replicaDeviceId: LAST_UNIT_REPLICA_A,
  invoiceItemId: "item-a",
  saleMovementId: "move-a",
});

export const lastUnitBuyerBCommand = issueInvoice({
  commandId: "sale-b",
  replicaDeviceId: LAST_UNIT_REPLICA_B,
  invoiceItemId: "item-b",
  saleMovementId: "move-b",
});

export const lastUnitEnvelope = (input: {
  readonly replicaId: string;
  readonly clientSequence: string;
  readonly command: IssueInvoiceCommand;
}): SyncCommandEnvelope => {
  const command = { _tag: "issueInvoice" as const, payload: input.command };
  return {
    organizationId: LAST_UNIT_ORGANIZATION_ID,
    epoch: LAST_UNIT_EPOCH,
    replicaId: input.replicaId,
    clientSequence: ReplicaClientSequence.make(input.clientSequence),
    operationId: input.command.commandId,
    payloadHash: canonicalPayloadHash(command),
    command,
  };
};

export const lastUnitBuyerAEnvelope = lastUnitEnvelope({
  replicaId: LAST_UNIT_REPLICA_A,
  clientSequence: "1",
  command: lastUnitBuyerACommand,
});

export const lastUnitBuyerBEnvelope = lastUnitEnvelope({
  replicaId: LAST_UNIT_REPLICA_B,
  clientSequence: "1",
  command: lastUnitBuyerBCommand,
});
