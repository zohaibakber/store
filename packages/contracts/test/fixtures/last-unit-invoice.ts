import {
  decodeBatchId,
  decodeInvoiceId,
  decodeInvoiceItemId,
  decodeOrganizationId,
  decodeProductId,
  decodeReplicaId,
  OperationId,
  type ReplicaId,
} from "../../src/ids";
import { Money } from "../../src/store/pricing";
import type { IssueInvoiceCommand } from "../../src/store/schema";
import {
  ReplicaClientSequence,
  type SyncCommandEnvelope,
  SyncEpoch,
} from "../../src/sync/protocol";

export const LAST_UNIT_ORGANIZATION_ID = decodeOrganizationId("org-1");
export const LAST_UNIT_REPLICA_A = decodeReplicaId("replica-a");
export const LAST_UNIT_REPLICA_B = decodeReplicaId("replica-b");
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
      salePrice: Money.make(100),
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

const lastUnitEnvelope = (input: {
  readonly replicaId: ReplicaId;
  readonly clientSequence: string;
  readonly command: IssueInvoiceCommand;
  readonly payloadHash: string;
}): SyncCommandEnvelope => {
  const command = { _tag: "issueInvoice" as const, payload: input.command };
  return {
    organizationId: LAST_UNIT_ORGANIZATION_ID,
    epoch: LAST_UNIT_EPOCH,
    replicaId: input.replicaId,
    clientSequence: ReplicaClientSequence.make(input.clientSequence),
    operationId: OperationId.make(input.command.commandId),
    payloadHash: input.payloadHash,
    command,
  };
};

export const lastUnitBuyerAEnvelope = lastUnitEnvelope({
  replicaId: LAST_UNIT_REPLICA_A,
  clientSequence: "1",
  command: lastUnitBuyerACommand,
  payloadHash: "32deba780e9ff29bb64bf8e00351f7341f16d1c4360dc1773a689a3403980050",
});

export const lastUnitBuyerBEnvelope = lastUnitEnvelope({
  replicaId: LAST_UNIT_REPLICA_B,
  clientSequence: "1",
  command: lastUnitBuyerBCommand,
  payloadHash: "bcd012371f1696393baa07aeb152a4cf1d55218161c2e6980e3b9e0ddbc19336",
});
