const DOMAIN_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS categories (
  id text not null,
  name text not null,
  tracksPacks integer not null default 1,
  createdAt integer not null,
  updatedAt integer not null,
  deletedAt integer,
  organizationId text not null,
  createdByUserId text not null,
  updatedByUserId text not null,
  deviceId text not null,
  operationId text not null,
  rowVersion integer not null default 1,
  primary key (organizationId, id)
);

CREATE TABLE IF NOT EXISTS products (
  id text not null,
  name text not null,
  categoryId text not null default 'general',
  aisle text,
  composition text,
  strength text,
  unitsPerPack integer not null default 1,
  purchasePrice integer,
  retailPrice integer,
  unitPrice integer,
  visible integer not null default 1,
  createdAt integer not null,
  updatedAt integer not null,
  deletedAt integer,
  organizationId text not null,
  createdByUserId text not null,
  updatedByUserId text not null,
  deviceId text not null,
  operationId text not null,
  rowVersion integer not null default 1,
  primary key (organizationId, id)
);

CREATE TABLE IF NOT EXISTS batches (
  id text not null,
  productId text not null,
  batchNumber text,
  expiresAt integer,
  packQuantity integer not null default 0,
  unitQuantity integer not null default 0,
  createdAt integer not null,
  updatedAt integer not null,
  deletedAt integer,
  organizationId text not null,
  createdByUserId text not null,
  updatedByUserId text not null,
  deviceId text not null,
  operationId text not null,
  rowVersion integer not null default 1,
  primary key (organizationId, id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id text not null,
  invoiceNumber integer not null,
  customerName text,
  total integer not null default 0,
  createdAt integer not null,
  updatedAt integer not null,
  deletedAt integer,
  organizationId text not null,
  createdByUserId text not null,
  updatedByUserId text not null,
  deviceId text not null,
  operationId text not null,
  rowVersion integer not null default 1,
  primary key (organizationId, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS invoices_organization_id_invoice_number_uidx
  on invoices (organizationId, invoiceNumber);

CREATE UNIQUE INDEX IF NOT EXISTS invoices_organization_id_operation_id_uidx
  on invoices (organizationId, operationId);

CREATE TABLE IF NOT EXISTS invoice_items (
  id text not null,
  invoiceId text not null,
  productId text not null,
  batchId text not null,
  productName text not null,
  batchNumber text,
  quantity integer not null,
  quantityType text not null default 'unit',
  baseUnitQuantity integer not null,
  salePrice integer not null,
  createdAt integer not null,
  updatedAt integer not null,
  deletedAt integer,
  organizationId text not null,
  createdByUserId text not null,
  updatedByUserId text not null,
  deviceId text not null,
  operationId text not null,
  rowVersion integer not null default 1,
  primary key (organizationId, id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id text not null,
  productId text not null,
  batchId text not null,
  invoiceId text,
  type text not null,
  packDelta integer not null default 0,
  unitDelta integer not null default 0,
  note text,
  organizationId text not null,
  actorUserId text not null,
  deviceId text not null,
  operationId text not null,
  createdAt integer not null,
  primary key (organizationId, id)
);
`;

export const INVENTORY_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
${DOMAIN_TABLES_SQL}

CREATE TABLE IF NOT EXISTS inventory_state (
  organizationId text not null primary key,
  status text not null,
  epoch text not null,
  commitSequence text not null,
  retentionFloor text not null
);

CREATE TABLE IF NOT EXISTS replicas (
  organizationId text not null,
  replicaId text not null,
  ownerUserId text not null,
  deviceLabel text,
  lastClientSequence text not null,
  primary key (organizationId, replicaId)
);

CREATE TABLE IF NOT EXISTS command_receipts (
  organizationId text not null,
  operationId text not null,
  replicaId text not null,
  clientSequence text not null,
  payloadHash text not null,
  decision text not null,
  commitSequence text not null,
  resultJson text not null,
  receivedAt integer not null,
  primary key (organizationId, operationId)
);

CREATE UNIQUE INDEX IF NOT EXISTS command_receipts_organization_replica_sequence_uidx
  on command_receipts (organizationId, replicaId, clientSequence);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  organizationId text not null,
  commitSequence text not null,
  operationId text not null,
  decision text not null,
  epoch text not null,
  primary key (organizationId, commitSequence)
);

CREATE TABLE IF NOT EXISTS inventory_changes (
  organizationId text not null,
  commitSequence text not null,
  ordinal integer not null,
  entity text not null,
  action text not null,
  entityId text not null,
  rowVersion integer not null,
  rowJson text not null,
  primary key (organizationId, commitSequence, ordinal)
);
`;

export const REPLICA_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
${DOMAIN_TABLES_SQL}

CREATE TABLE IF NOT EXISTS replica_state (
  id text not null primary key,
  organizationId text not null,
  userId text not null,
  replicaId text not null,
  epoch text not null,
  appliedCommitSequence text not null,
  nextClientSequence text not null,
  localCommitVersion integer not null
);

CREATE TABLE IF NOT EXISTS command_outbox (
  operationId text not null primary key,
  status text not null,
  envelopeJson text not null,
  receiptJson text,
  clientSequence text not null,
  createdAt integer not null
);

CREATE TABLE IF NOT EXISTS stock_overlays (
  commandId text not null,
  batchId text not null,
  packDelta integer not null,
  unitDelta integer not null,
  nextPackQuantity integer not null,
  nextUnitQuantity integer not null,
  primary key (commandId, batchId)
);
`;
