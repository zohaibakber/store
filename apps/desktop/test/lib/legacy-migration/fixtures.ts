import type { NodeReplicaSqlite } from "@store/client-db/node-sqlite";

import type { LegacyArchive, LegacyCrudRow } from "../../../src/lib/legacy-migration/model";

export const ORGANIZATION_ID = "org_e2e1";
export const USER_ID = "user_e2e1";
export const REPLICA_ID = "replica-1";
export const API_BASE_URL = "http://127.0.0.1:9";
export const LEGACY_DEVICE = "legacy-device-1";
export const T0 = 1_757_000_000_000;

export const identity = {
  organizationId: ORGANIZATION_ID,
  userId: USER_ID,
  replicaId: REPLICA_ID,
};

export const actor = {
  organizationId: ORGANIZATION_ID,
  userId: USER_ID,
  deviceId: REPLICA_ID,
};

export const crudRows: ReadonlyArray<LegacyCrudRow> = [
  {
    id: 9,
    tx_id: 4,
    data: '{"op":"PUT","id":"c-new","type":"categories","data":{"createdAt":1757000002000.0,"createdByUserId":"user_e2e1","deviceId":"legacy-device-1","name":"Syrups","operationId":"op-1","organizationId":"org_e2e1","rowVersion":1,"tracksPacks":1,"updatedAt":1757000002000.0,"updatedByUserId":"user_e2e1"}}',
  },
  {
    id: 10,
    tx_id: 5,
    data: '{"op":"PUT","id":"p-new","type":"products","data":{"aisle":"A1","categoryId":"c-new","composition":"Paracetamol","createdAt":1757000003000.0,"createdByUserId":"user_e2e1","deviceId":"legacy-device-1","name":"Calpol","operationId":"op-2","organizationId":"org_e2e1","purchasePrice":100,"retailPrice":90,"rowVersion":1,"strength":"500mg","unitPrice":12,"unitsPerPack":10,"updatedAt":1757000003000.0,"updatedByUserId":"user_e2e1","visible":1}}',
  },
  {
    id: 11,
    tx_id: 6,
    data: '{"op":"PUT","id":"b-new","type":"batches","data":{"batchNumber":"BN-b-new","createdAt":1757000004000.0,"createdByUserId":"user_e2e1","deviceId":"legacy-device-1","expiresAt":1788536000000.0,"operationId":"op-3","organizationId":"org_e2e1","packQuantity":3,"productId":"p-new","rowVersion":1,"unitQuantity":0,"updatedAt":1757000004000.0,"updatedByUserId":"user_e2e1"}}',
  },
  {
    id: 12,
    tx_id: 7,
    data: '{"op":"PATCH","id":"p-synced","type":"products","data":{"operationId":"op-4","retailPrice":150,"rowVersion":2,"updatedAt":1757000005000},"old":{"name":"Panadol","categoryId":"c-synced","aisle":"A1","composition":"Paracetamol","strength":"500mg","unitsPerPack":10,"purchasePrice":100,"retailPrice":120,"unitPrice":12,"visible":1,"organizationId":"org_e2e1","createdByUserId":"user_e2e1","updatedByUserId":"user_e2e1","deviceId":"legacy-device-1","operationId":"op-seed","rowVersion":1,"createdAt":1757000000000,"updatedAt":1757000000000,"deletedAt":null}}',
  },
  {
    id: 13,
    tx_id: 8,
    data: '{"op":"PATCH","id":"b-synced","type":"batches","data":{"operationId":"op-5","packQuantity":5,"rowVersion":3,"updatedAt":1757000006000},"old":{"productId":"p-synced","batchNumber":"BN-b-synced","expiresAt":1788536000000,"packQuantity":4,"unitQuantity":0,"organizationId":"org_e2e1","createdByUserId":"user_e2e1","updatedByUserId":"user_e2e1","deviceId":"legacy-device-1","operationId":"cmd-synced","rowVersion":2,"createdAt":1757000000000,"updatedAt":1757000001000,"deletedAt":null}}',
  },
  {
    id: 14,
    tx_id: 9,
    data: '{"op":"PUT","id":"inv-unsynced","type":"invoices","data":{"createdAt":1757000009000.0,"createdByUserId":"user_e2e1","customerName":"Walk-in","deviceId":"legacy-device-1","invoiceNumber":2,"operationId":"cmd-unsynced","organizationId":"org_e2e1","rowVersion":1,"total":150,"updatedAt":1757000009000.0,"updatedByUserId":"user_e2e1"}}',
  },
  {
    id: 15,
    tx_id: 9,
    data: '{"op":"PUT","id":"inv-unsynced-item-1","type":"invoice_items","data":{"baseUnitQuantity":10,"batchId":"b-synced","batchNumber":"BN-b-synced","createdAt":1757000009000.0,"createdByUserId":"user_e2e1","deviceId":"legacy-device-1","invoiceId":"inv-unsynced","operationId":"cmd-unsynced","organizationId":"org_e2e1","productId":"p-synced","productName":"Panadol","quantity":1,"quantityType":"pack","rowVersion":1,"salePrice":150,"updatedAt":1757000009000.0,"updatedByUserId":"user_e2e1"}}',
  },
  {
    id: 16,
    tx_id: 9,
    data: '{"op":"PUT","id":"inv-unsynced-move-1","type":"stock_movements","data":{"actorUserId":"user_e2e1","batchId":"b-synced","createdAt":1757000009000.0,"deviceId":"legacy-device-1","invoiceId":"inv-unsynced","note":"Invoice #2","operationId":"cmd-unsynced","organizationId":"org_e2e1","packDelta":-1,"productId":"p-synced","type":"sale","unitDelta":0}}',
  },
  {
    id: 17,
    tx_id: 9,
    data: '{"op":"PATCH","id":"b-synced","type":"batches","data":{"operationId":"cmd-unsynced","packQuantity":4,"rowVersion":4,"updatedAt":1757000009000},"old":{"productId":"p-synced","batchNumber":"BN-b-synced","expiresAt":1788536000000,"packQuantity":5,"unitQuantity":0,"organizationId":"org_e2e1","createdByUserId":"user_e2e1","updatedByUserId":"user_e2e1","deviceId":"legacy-device-1","operationId":"op-5","rowVersion":3,"createdAt":1757000000000,"updatedAt":1757000006000,"deletedAt":null}}',
  },
  {
    id: 18,
    tx_id: 10,
    data: '{"op":"PATCH","id":"c-gone","type":"categories","data":{"deletedAt":1757000010000,"operationId":"op-7","rowVersion":2,"updatedAt":1757000010000},"old":{"name":"Retired","tracksPacks":1,"organizationId":"org_e2e1","createdByUserId":"user_e2e1","updatedByUserId":"user_e2e1","deviceId":"legacy-device-1","operationId":"op-seed","rowVersion":1,"createdAt":1757000000000,"updatedAt":1757000000000,"deletedAt":null}}',
  },
];

const journalCommand = (input: {
  readonly invoiceId: string;
  readonly commandId: string;
  readonly invoiceNumber: number;
  readonly occurredAt: number;
}) => ({
  command: {
    commandId: input.commandId,
    deviceId: LEGACY_DEVICE,
    occurredAt: input.occurredAt,
    invoiceId: input.invoiceId,
    invoiceNumber: input.invoiceNumber,
    input: {
      customerName: "Walk-in",
      items: [
        {
          productId: "p-synced",
          batchId: "b-synced",
          quantity: 1,
          quantityType: "pack",
          salePrice: 150,
        },
      ],
    },
    allocations: [
      {
        invoiceItemId: `${input.invoiceId}-item-1`,
        saleMovementId: `${input.invoiceId}-move-1`,
        openPackMovementId: null,
        productId: "p-synced",
        batchId: "b-synced",
        quantity: 1,
        quantityType: "pack",
        salePrice: 150,
        packsOpened: 0,
      },
    ],
  },
  invoice: {
    id: input.invoiceId,
    invoiceNumber: input.invoiceNumber,
    customerName: "Walk-in",
    total: 150,
    organizationId: ORGANIZATION_ID,
    createdByUserId: USER_ID,
    updatedByUserId: USER_ID,
    deviceId: LEGACY_DEVICE,
    operationId: input.commandId,
    rowVersion: 1,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    deletedAt: null,
  },
  items: [],
  movements: [],
});

export const journal = {
  "cmd-synced": journalCommand({
    invoiceId: "inv-synced",
    commandId: "cmd-synced",
    invoiceNumber: 1,
    occurredAt: T0 + 1_000,
  }),
  "cmd-server": journalCommand({
    invoiceId: "inv-server",
    commandId: "cmd-server",
    invoiceNumber: 3,
    occurredAt: T0 + 8_000,
  }),
  "cmd-unsynced": journalCommand({
    invoiceId: "inv-unsynced",
    commandId: "cmd-unsynced",
    invoiceNumber: 2,
    occurredAt: T0 + 9_000,
  }),
};

export const legacyDatabase = (name: string) => ({
  name,
  crud: crudRows,
  tables: {
    categories: [{ id: "c-synced" }, { id: "c-gone" }, { id: "c-new" }],
    products: [{ id: "p-synced" }, { id: "p-new" }],
    batches: [{ id: "b-synced" }, { id: "b-new" }],
    invoices: [
      { id: "inv-synced", invoiceNumber: 1 },
      { id: "inv-unsynced", invoiceNumber: 2 },
    ],
    invoice_items: [],
    stock_movements: [],
  },
});

export const legacyArchive = (databaseName: string): LegacyArchive => ({
  version: 1,
  organizationId: ORGANIZATION_ID,
  apiBaseUrl: API_BASE_URL,
  capturedAt: T0 + 20_000,
  databases: [legacyDatabase(databaseName)],
  saleOutbox: [{ key: `tabaaq.sale-outbox.${ORGANIZATION_ID}`, value: JSON.stringify(journal) }],
});

const managed = (rowVersion: number) =>
  `'${ORGANIZATION_ID}', 'server-user', 'server-user', 'server-device', 'server-op', ${rowVersion}`;

export const seedServerReplica = async (replica: NodeReplicaSqlite) => {
  const run = (sql: string) => replica.query(sql, []);
  await run(
    `insert into categories (id, name, tracksPacks, createdAt, updatedAt, organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion) values ('c-synced', 'Tablets', 1, 1, 2, ${managed(3)})`,
  );
  await run(
    `insert into products (id, name, categoryId, aisle, composition, strength, unitsPerPack, purchasePrice, retailPrice, unitPrice, visible, createdAt, updatedAt, organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion) values ('p-synced', 'Panadol Extra', 'c-synced', 'A1', 'Paracetamol', '500mg', 10, 100, 120, 12, 1, 1, 2, ${managed(4)})`,
  );
  await run(
    `insert into batches (id, productId, batchNumber, expiresAt, packQuantity, unitQuantity, createdAt, updatedAt, organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion) values ('b-synced', 'p-synced', 'BN-b-synced', 1788536000000, 3, 0, 1, 2, ${managed(5)})`,
  );
  await run(
    `insert into invoices (id, invoiceNumber, customerName, total, createdAt, updatedAt, organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion) values ('inv-server', 2, 'Walk-in', 150, 1, 1, '${ORGANIZATION_ID}', 'server-user', 'server-user', 'server-device', 'cmd-server', 1)`,
  );
};
