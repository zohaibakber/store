import {
  SyncCommand,
  SyncPullResult,
  SyncTransactionGroup,
  type SnapshotRow,
  type SyncEntity,
} from "@store/contracts";
import * as Schema from "effect/Schema";

export const GENERATOR_VERSION = 1;

export const ORGANIZATION_ID = "org-bench";
export const USER_ID = "user-bench";
const DEVICE_ID = "device-bench";
export const REPLICA_ID = "replica-bench";
export const EPOCH = "1";
export const INCARNATION = "local";
export const BASE_COMMIT_SEQUENCE = 1_000_000;

export const DAY_MILLIS = 86_400_000;
export const NOW = Date.UTC(2026, 8, 30);
const HISTORY_DAYS = 730;
const HISTORY_START = NOW - HISTORY_DAYS * DAY_MILLIS;
const HISTORY_SPAN = HISTORY_DAYS * DAY_MILLIS - 3_600_000;

const ITEMS_PER_INVOICE = 4;
const BATCHES_PER_PRODUCT = 3;
const SALE_MOVEMENTS_PER_INVOICE = 3;

export type FixtureCounts = {
  readonly products: number;
  readonly categories: number;
  readonly batches: number;
  readonly invoices: number;
  readonly invoiceItems: number;
  readonly stockMovements: number;
};

export const countsFor = (products: number): FixtureCounts => {
  const batches = products * BATCHES_PER_PRODUCT;
  const invoices = Math.round(products * 2.5);
  return {
    products,
    categories: Math.max(30, Math.round(products / 500)),
    batches,
    invoices,
    invoiceItems: invoices * ITEMS_PER_INVOICE,
    stockMovements: batches + invoices * SALE_MOVEMENTS_PER_INVOICE,
  };
};

export const totalRows = (counts: FixtureCounts): number =>
  counts.products +
  counts.categories +
  counts.batches +
  counts.invoices +
  counts.invoiceItems +
  counts.stockMovements;

const KIND = {
  category: 1,
  product: 2,
  batch: 3,
  invoice: 4,
  item: 5,
  movement: 6,
  command: 7,
  extra: 8,
} as const;

const mix = (a: number, b: number, c: number): number => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= Math.imul(c + 0x165667b1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
};

const draw = (kind: number, index: number, salt: number, bound: number): number =>
  mix(kind, index, salt) % bound;

const unit = (kind: number, index: number, salt: number): number =>
  mix(kind, index, salt) / 4_294_967_296;

const hex8 = (value: number): string => value.toString(16).padStart(8, "0");

const uuidOf = (kind: number, index: number): string => {
  const a = hex8(mix(kind, index, 101));
  const b = hex8(mix(kind, index, 202));
  const c = hex8(mix(kind, index, 303));
  const d = hex8(mix(kind, index, 404));
  const variant = (0x8 + (mix(kind, index, 505) % 4)).toString(16);
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-${variant}${c.slice(1, 4)}-${c.slice(4)}${d.slice(0, 4)}`;
};

const SYLLABLE_A = [
  "Am",
  "Ce",
  "Ci",
  "Do",
  "Er",
  "Fu",
  "Ga",
  "Ib",
  "Ke",
  "La",
  "Lo",
  "Me",
  "Na",
  "No",
  "Om",
  "Pa",
  "Pe",
  "Ra",
  "Ro",
  "Sa",
  "Se",
  "Ta",
  "Te",
  "Ur",
  "Va",
  "Vi",
  "Xa",
  "Zo",
  "Al",
  "Bu",
  "Cl",
  "Di",
  "Es",
  "Fl",
  "Gl",
  "Hy",
  "In",
  "Lu",
  "Mo",
  "Ni",
];
const SYLLABLE_B = [
  "cra",
  "flo",
  "ga",
  "mi",
  "nox",
  "pri",
  "quo",
  "rel",
  "sta",
  "tro",
  "vex",
  "zan",
  "bel",
  "cor",
  "dal",
  "fen",
  "gen",
  "hal",
  "lam",
  "mar",
  "nel",
  "pan",
  "rin",
  "sol",
  "tan",
  "vir",
  "zil",
  "ben",
  "cef",
  "dex",
  "far",
  "gli",
  "hep",
  "kal",
  "lev",
  "mox",
  "nif",
  "oxy",
  "pro",
  "tri",
];
const SYLLABLE_C = [
  "dine",
  "lol",
  "mide",
  "nac",
  "pam",
  "rol",
  "sone",
  "tin",
  "zole",
  "xin",
  "vir",
  "pril",
  "statin",
  "cillin",
  "mycin",
  "fenac",
  "profen",
  "tadine",
  "cetam",
  "barb",
  "line",
  "done",
  "fine",
  "pine",
  "zepam",
];
const STRENGTHS = [
  "5 mg",
  "10 mg",
  "20 mg",
  "25 mg",
  "40 mg",
  "50 mg",
  "100 mg",
  "200 mg",
  "250 mg",
  "400 mg",
  "500 mg",
  "650 mg",
  "1 g",
];
const FORMS = [
  "Tablets",
  "Capsules",
  "Syrup",
  "Injection",
  "Cream",
  "Ointment",
  "Drops",
  "Suspension",
  "Gel",
  "Sachet",
];
const CATEGORY_STEMS = [
  "Analgesics",
  "Antibiotics",
  "Antacids",
  "Antihistamines",
  "Cardiac",
  "Dermatology",
  "Diabetes",
  "Eye care",
  "Gastro",
  "Hormones",
  "Respiratory",
  "Vitamins",
];
const UNITS_PER_PACK = [1, 5, 10, 10, 10, 12, 14, 15, 20, 30, 50, 100];

const capitalized = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

const brandOf = (index: number): string =>
  `${SYLLABLE_A[draw(KIND.product, index, 1, SYLLABLE_A.length)]}${SYLLABLE_B[draw(KIND.product, index, 2, SYLLABLE_B.length)]}${SYLLABLE_C[draw(KIND.product, index, 3, SYLLABLE_C.length)]}`;

const genericOf = (index: number): string =>
  `${SYLLABLE_A[draw(KIND.product, index, 4, SYLLABLE_A.length)]}${SYLLABLE_B[draw(KIND.product, index, 5, SYLLABLE_B.length)]}${SYLLABLE_C[draw(KIND.product, index, 6, SYLLABLE_C.length)]}`.toLowerCase();

const strengthOf = (index: number): string =>
  STRENGTHS[draw(KIND.product, index, 7, STRENGTHS.length)] ?? "10 mg";

const formOf = (index: number): string =>
  FORMS[draw(KIND.product, index, 8, FORMS.length)] ?? "Tablets";

export const productName = (index: number): string =>
  `${capitalized(brandOf(index))} ${strengthOf(index)} ${formOf(index)}`;

type Metadata = {
  readonly organizationId: string;
  readonly createdByUserId: string;
  readonly updatedByUserId: string;
  readonly deviceId: string;
  readonly operationId: string;
  readonly rowVersion: number;
};

const metadata = (operationId: string, rowVersion: number): Metadata => ({
  organizationId: ORGANIZATION_ID,
  createdByUserId: USER_ID,
  updatedByUserId: USER_ID,
  deviceId: DEVICE_ID,
  operationId,
  rowVersion,
});

type CategoryRowData = {
  readonly id: string;
  readonly name: string;
  readonly tracksPacks: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
} & Metadata;

type ProductRowData = {
  readonly id: string;
  readonly name: string;
  readonly categoryId: string;
  readonly aisle: string | null;
  readonly composition: string | null;
  readonly strength: string | null;
  readonly unitsPerPack: number;
  readonly purchasePrice: number | null;
  readonly retailPrice: number | null;
  readonly unitPrice: number | null;
  readonly visible: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
} & Metadata;

type BatchRowData = {
  readonly id: string;
  readonly productId: string;
  readonly batchNumber: string | null;
  readonly expiresAt: number | null;
  readonly packQuantity: number;
  readonly unitQuantity: number;
  readonly createdAt: number;
  readonly updatedAt: number;
} & Metadata;

type InvoiceRowData = {
  readonly id: string;
  readonly invoiceNumber: number;
  readonly customerName: string | null;
  readonly total: number;
  readonly createdAt: number;
  readonly updatedAt: number;
} & Metadata;

type InvoiceItemRowData = {
  readonly id: string;
  readonly invoiceId: string;
  readonly productId: string;
  readonly batchId: string;
  readonly productName: string;
  readonly batchNumber: string | null;
  readonly quantity: number;
  readonly quantityType: "unit" | "pack";
  readonly baseUnitQuantity: number;
  readonly salePrice: number;
  readonly createdAt: number;
  readonly updatedAt: number;
} & Metadata;

type StockMovementRowData = {
  readonly id: string;
  readonly productId: string;
  readonly batchId: string;
  readonly invoiceId: string | null;
  readonly type: "stock_in" | "sale" | "open_pack" | "adjustment";
  readonly packDelta: number;
  readonly unitDelta: number;
  readonly note: string | null;
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly deviceId: string;
  readonly operationId: string;
  readonly createdAt: number;
};

export const categoryId = (index: number): string => uuidOf(KIND.category, index);
export const productId = (index: number): string => uuidOf(KIND.product, index);
export const batchId = (index: number): string => uuidOf(KIND.batch, index);
export const invoiceId = (index: number): string => uuidOf(KIND.invoice, index);

export const categoryRow = (index: number, rowVersion = 1): CategoryRowData => {
  const stem = CATEGORY_STEMS[index % CATEGORY_STEMS.length] ?? "General";
  const createdAt = HISTORY_START + draw(KIND.category, index, 1, DAY_MILLIS);
  return {
    id: categoryId(index),
    name:
      index < CATEGORY_STEMS.length
        ? stem
        : `${stem} ${Math.floor(index / CATEGORY_STEMS.length) + 1}`,
    tracksPacks: draw(KIND.category, index, 2, 20) !== 0,
    createdAt,
    updatedAt: createdAt,
    ...metadata(`seed-category-${index}`, rowVersion),
  };
};

const productCategoryIndex = (counts: FixtureCounts, index: number): number =>
  draw(KIND.product, index, 9, counts.categories);

export const productRow = (
  counts: FixtureCounts,
  index: number,
  rowVersion = 1,
): ProductRowData => {
  const createdAt = HISTORY_START + draw(KIND.product, index, 10, 30 * DAY_MILLIS);
  const purchase = 50 + draw(KIND.product, index, 11, 9_950);
  const retail = Math.round(purchase * (1.1 + unit(KIND.product, index, 12) * 0.5));
  const aisleDraw = draw(KIND.product, index, 13, 40);
  return {
    id: productId(index),
    name: productName(index),
    categoryId: categoryId(productCategoryIndex(counts, index)),
    aisle: draw(KIND.product, index, 14, 10) === 0 ? null : `Aisle ${aisleDraw + 1}`,
    composition: `${genericOf(index)} ${strengthOf(index)}`,
    strength: strengthOf(index),
    unitsPerPack: UNITS_PER_PACK[draw(KIND.product, index, 15, UNITS_PER_PACK.length)] ?? 1,
    purchasePrice: purchase,
    retailPrice: retail,
    unitPrice: null,
    visible: draw(KIND.product, index, 16, 33) !== 0,
    createdAt,
    updatedAt: createdAt,
    ...metadata(`seed-product-${index}`, rowVersion),
  };
};

const batchStock = (index: number) => ({
  pack: draw(KIND.batch, index, 1, 10) === 0 ? 0 : draw(KIND.batch, index, 2, 200),
  unit: 3 + draw(KIND.batch, index, 3, 28),
});

export const batchRow = (index: number, rowVersion = 1, packDrop = 0): BatchRowData => {
  const product = Math.floor(index / BATCHES_PER_PRODUCT);
  const createdAt = HISTORY_START + draw(KIND.batch, index, 4, 60 * DAY_MILLIS);
  const stock = batchStock(index);
  const expiryDraw = draw(KIND.batch, index, 5, 10);
  return {
    id: batchId(index),
    productId: productId(product),
    batchNumber: `B${draw(KIND.batch, index, 6, 900_000) + 100_000}`,
    expiresAt:
      expiryDraw === 0
        ? NOW - draw(KIND.batch, index, 7, 200) * DAY_MILLIS
        : NOW + (30 + draw(KIND.batch, index, 8, 870)) * DAY_MILLIS,
    packQuantity: Math.max(0, stock.pack - packDrop),
    unitQuantity: stock.unit,
    createdAt,
    updatedAt: createdAt,
    ...metadata(`seed-batch-${index}`, rowVersion),
  };
};

const invoiceCreatedAt = (counts: FixtureCounts, index: number): number =>
  HISTORY_START +
  Math.floor((index * HISTORY_SPAN) / counts.invoices) +
  draw(KIND.invoice, index, 1, 3_600_000);

const CUSTOMERS = [
  "Walk-in",
  "A. Rahman",
  "S. Khan",
  "M. Ali",
  "Clinic North",
  "Clinic South",
  "Hina Store",
  "Bilal Traders",
];

type ItemDraft = {
  readonly index: number;
  readonly productIndex: number;
  readonly batchIndex: number;
  readonly quantity: number;
  readonly salePrice: number;
};

const itemDraft = (counts: FixtureCounts, invoiceIndex: number, slot: number): ItemDraft => {
  const index = invoiceIndex * ITEMS_PER_INVOICE + slot;
  const skewed = unit(KIND.item, index, 1) ** 2;
  const productIndex = Math.min(counts.products - 1, Math.floor(skewed * counts.products));
  const batchIndex =
    productIndex * BATCHES_PER_PRODUCT + draw(KIND.item, index, 2, BATCHES_PER_PRODUCT);
  const salePrice = productRow(counts, productIndex).retailPrice ?? 100;
  return {
    index,
    productIndex,
    batchIndex,
    quantity: 1 + draw(KIND.item, index, 3, 5),
    salePrice,
  };
};

type InvoiceBundle = {
  readonly invoice: InvoiceRowData;
  readonly items: ReadonlyArray<InvoiceItemRowData>;
  readonly movements: ReadonlyArray<StockMovementRowData>;
};

export const invoiceBundle = (counts: FixtureCounts, index: number): InvoiceBundle => {
  const createdAt = invoiceCreatedAt(counts, index);
  const id = invoiceId(index);
  const operationId = `seed-invoice-${index}`;
  const drafts = Array.from({ length: ITEMS_PER_INVOICE }, (_, slot) =>
    itemDraft(counts, index, slot),
  );
  const items = drafts.map((draft): InvoiceItemRowData => ({
    id: uuidOf(KIND.item, draft.index),
    invoiceId: id,
    productId: productId(draft.productIndex),
    batchId: batchId(draft.batchIndex),
    productName: productName(draft.productIndex),
    batchNumber: `B${draw(KIND.batch, draft.batchIndex, 6, 900_000) + 100_000}`,
    quantity: draft.quantity,
    quantityType: "unit",
    baseUnitQuantity: draft.quantity,
    salePrice: draft.salePrice,
    createdAt,
    updatedAt: createdAt,
    ...metadata(operationId, 1),
  }));
  const movements = drafts
    .slice(0, SALE_MOVEMENTS_PER_INVOICE)
    .map((draft, slot): StockMovementRowData => ({
      id: uuidOf(KIND.movement, counts.batches + index * SALE_MOVEMENTS_PER_INVOICE + slot),
      productId: productId(draft.productIndex),
      batchId: batchId(draft.batchIndex),
      invoiceId: id,
      type: "sale",
      packDelta: 0,
      unitDelta: -draft.quantity,
      note: `Invoice #${index + 1}`,
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_ID,
      deviceId: DEVICE_ID,
      operationId,
      createdAt,
    }));
  return {
    invoice: {
      id,
      invoiceNumber: index + 1,
      customerName:
        draw(KIND.invoice, index, 2, 10) < 7
          ? null
          : (CUSTOMERS[draw(KIND.invoice, index, 3, CUSTOMERS.length)] ?? null),
      total: drafts.reduce((sum, draft) => sum + draft.quantity * draft.salePrice, 0),
      createdAt,
      updatedAt: createdAt,
      ...metadata(operationId, 1),
    },
    items,
    movements,
  };
};

export const stockInMovement = (index: number): StockMovementRowData => {
  const batch = batchRow(index);
  return {
    id: uuidOf(KIND.movement, index),
    productId: batch.productId,
    batchId: batch.id,
    invoiceId: null,
    type: "stock_in",
    packDelta: batch.packQuantity,
    unitDelta: batch.unitQuantity,
    note: "Opening stock",
    organizationId: ORGANIZATION_ID,
    actorUserId: USER_ID,
    deviceId: DEVICE_ID,
    operationId: `seed-batch-${index}`,
    createdAt: batch.createdAt,
  };
};

type SearchProbe = { readonly label: string; readonly query: string };

export const searchProbes = (counts: FixtureCounts): ReadonlyArray<SearchProbe> => {
  const pick = (salt: number) => draw(KIND.extra, salt, 1, counts.products);
  const probes: Array<SearchProbe> = [];
  for (let slot = 0; slot < 6; slot += 1) {
    const index = pick(slot);
    const brand = brandOf(index).toLowerCase();
    probes.push({ label: "prefix-4", query: brand.slice(0, 4) });
    probes.push({ label: "full-brand", query: brand });
    probes.push({
      label: "brand-strength",
      query: `${brand.slice(0, 3)} ${strengthOf(index).split(" ")[0]}`,
    });
    probes.push({ label: "word-form", query: formOf(index).toLowerCase() });
  }
  probes.push({ label: "miss", query: "zzqx" });
  probes.push({ label: "two-token-miss", query: "zzqx tablets" });
  return probes;
};

export const invoicePageOffset = (counts: FixtureCounts, pageSize: number): number =>
  Math.floor((counts.invoices * 0.8) / pageSize) * pageSize;

export const movementPageOffset = (counts: FixtureCounts, pageSize: number): number =>
  Math.floor((counts.stockMovements * 0.8) / pageSize) * pageSize;

export const productPageIndexes = (
  counts: FixtureCounts,
  pageSize: number,
): ReadonlyArray<number> => {
  const pages = Math.max(1, Math.ceil(counts.products / pageSize));
  return [
    0,
    1,
    2,
    Math.floor(pages / 4),
    Math.floor(pages / 2),
    Math.floor((pages * 3) / 4),
    pages - 1,
  ];
};

const decodeCommand = Schema.decodeUnknownSync(SyncCommand);
const decodePullResult = Schema.decodeUnknownSync(SyncPullResult);
const decodeGroup = Schema.decodeUnknownSync(SyncTransactionGroup);

const hotBatch = (counts: FixtureCounts, salt: number): number => {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const index = draw(KIND.command, salt * 10_007 + attempt, 1, counts.batches);
    if (batchStock(index).pack >= 40) return index;
  }
  return 0;
};

export const invoiceCommand = (
  counts: FixtureCounts,
  sequence: number,
  operationId: string,
  occurredAt: number,
) => {
  const lines = [0, 1, 2].map((slot) => {
    const batchIndex = hotBatch(counts, sequence * 3 + slot);
    const productIndex = Math.floor(batchIndex / BATCHES_PER_PRODUCT);
    const product = productRow(counts, productIndex);
    return {
      productIndex,
      batchIndex,
      type: slot === 0 ? ("pack" as const) : ("unit" as const),
      quantity: slot === 0 ? 1 : 2,
      price: product.retailPrice ?? 100,
    };
  });
  return decodeCommand({
    _tag: "issueInvoice",
    payload: {
      commandId: operationId,
      deviceId: DEVICE_ID,
      occurredAt,
      invoiceId: operationId,
      invoiceNumber: counts.invoices + 1 + sequence,
      input: {
        customerName: null,
        items: lines.map((line) => ({
          productId: productId(line.productIndex),
          batchId: batchId(line.batchIndex),
          quantity: line.quantity,
          quantityType: line.type,
          salePrice: line.price,
        })),
      },
      allocations: lines.map((line, slot) => ({
        invoiceItemId: `${operationId}-item-${slot}`,
        saleMovementId: `${operationId}-sale-${slot}`,
        openPackMovementId: null,
        productId: productId(line.productIndex),
        batchId: batchId(line.batchIndex),
        quantity: line.quantity,
        quantityType: line.type,
        salePrice: line.price,
        packsOpened: 0,
      })),
    },
  });
};

export const catalogCommand = (
  counts: FixtureCounts,
  sequence: number,
  operationId: string,
  occurredAt: number,
) => {
  const productIndex = draw(KIND.command, sequence, 2, counts.products);
  const product = productRow(counts, productIndex);
  return decodeCommand({
    _tag: "catalogWrite",
    payload: {
      commandId: operationId,
      deviceId: DEVICE_ID,
      occurredAt,
      writes: [
        {
          entity: "product",
          action: "upsert",
          id: product.id,
          expectedRowVersion: product.rowVersion,
          row: {
            name: product.name,
            categoryId: product.categoryId,
            aisle: product.aisle,
            composition: product.composition,
            strength: product.strength,
            unitsPerPack: product.unitsPerPack,
            purchasePrice: product.purchasePrice,
            retailPrice: (product.retailPrice ?? 100) + 1 + (sequence % 7),
            unitPrice: product.unitPrice,
            visible: product.visible,
          },
        },
        {
          entity: "batch",
          action: "upsert",
          id: `${operationId}-batch`,
          expectedRowVersion: null,
          movementId: `${operationId}-movement`,
          note: "Bench stock in",
          row: {
            productId: product.id,
            batchNumber: `BN${sequence}`,
            expiresAt: NOW + 400 * DAY_MILLIS,
            packQuantity: 12,
            unitQuantity: 0,
          },
        },
      ],
    },
  });
};

const REMOTE_GROUPS_PER_PAGE = 100;

const change = <Row>(entity: SyncEntity, entityId: string, rowVersion: number, row: Row) => ({
  entity,
  action: "upsert" as const,
  entityId,
  rowVersion,
  row,
});

const remoteGroupInput = (
  counts: FixtureCounts,
  page: number,
  group: number,
  commitSequence: number,
) => {
  const ordinal = page * REMOTE_GROUPS_PER_PAGE + group;
  const operationId = `remote-${page}-${group}`;
  const createdAt = NOW + (ordinal + 1) * 1_000;
  const invoiceIndex = counts.invoices + 100_000 + ordinal;
  const id = invoiceId(invoiceIndex);
  const drafts = [0, 1, 2].map((slot) => {
    const batchIndex = draw(KIND.extra, ordinal * 3 + slot, 2, counts.batches);
    const productIndex = Math.floor(batchIndex / BATCHES_PER_PRODUCT);
    return {
      slot,
      batchIndex,
      productIndex,
      price: productRow(counts, productIndex).retailPrice ?? 100,
    };
  });
  const changes = [
    change("invoice", id, 1, {
      id,
      invoiceNumber: invoiceIndex + 1,
      customerName: null,
      total: drafts.reduce((sum, draft) => sum + 2 * draft.price, 0),
      createdAt,
      updatedAt: createdAt,
      ...metadata(operationId, 1),
    }),
    ...drafts.map((draft) => {
      const itemId = `${operationId}-item-${draft.slot}`;
      return change("invoiceItem", itemId, 1, {
        id: itemId,
        invoiceId: id,
        productId: productId(draft.productIndex),
        batchId: batchId(draft.batchIndex),
        productName: productName(draft.productIndex),
        batchNumber: null,
        quantity: 2,
        quantityType: "unit",
        baseUnitQuantity: 2,
        salePrice: draft.price,
        createdAt,
        updatedAt: createdAt,
        ...metadata(operationId, 1),
      });
    }),
    ...drafts.map((draft) => {
      const movementId = `${operationId}-sale-${draft.slot}`;
      return change("stockMovement", movementId, 1, {
        id: movementId,
        productId: productId(draft.productIndex),
        batchId: batchId(draft.batchIndex),
        invoiceId: id,
        type: "sale",
        packDelta: 0,
        unitDelta: -2,
        note: `Invoice #${invoiceIndex + 1}`,
        organizationId: ORGANIZATION_ID,
        actorUserId: USER_ID,
        deviceId: DEVICE_ID,
        operationId,
        createdAt,
      });
    }),
    ...drafts.map((draft) => {
      const row = batchRow(draft.batchIndex, 2 + page, 0);
      return change("batch", row.id, row.rowVersion, {
        ...row,
        unitQuantity: Math.max(0, row.unitQuantity - 2),
        updatedAt: createdAt,
      });
    }),
  ];
  return {
    commitSequence: String(commitSequence),
    operationId,
    decision: "accepted" as const,
    changes,
  };
};

export const remoteGroup = (
  counts: FixtureCounts,
  page: number,
  group: number,
  commitSequence: number,
) => decodeGroup(remoteGroupInput(counts, page, group, commitSequence));

export const remotePage = (counts: FixtureCounts, page: number, appliedThrough: number) => {
  const groups = Array.from({ length: REMOTE_GROUPS_PER_PAGE }, (_, group) =>
    remoteGroupInput(counts, page, group, appliedThrough + group + 1),
  );
  const categoryGroup = {
    commitSequence: String(appliedThrough + REMOTE_GROUPS_PER_PAGE + 1),
    operationId: `remote-${page}-categories`,
    decision: "accepted" as const,
    changes: [
      change(
        "category",
        categoryId(page % counts.categories),
        2 + page,
        categoryRow(page % counts.categories, 2 + page),
      ),
      change("category", categoryId(counts.categories + 1_000 + page), 1, {
        ...categoryRow(counts.categories + 1_000 + page, 1),
        name: `Bench category ${page}`,
      }),
    ],
  };
  const transactions = [...groups, categoryGroup];
  const last = String(appliedThrough + transactions.length);
  return decodePullResult({
    epoch: EPOCH,
    incarnation: INCARNATION,
    subscription: "operational",
    schemaVersion: 1,
    transactions,
    nextCommitSequence: last,
    horizon: last,
    retentionFloor: "0",
  });
};

export const remotePageChanges = (page: Schema.Schema.Type<typeof SyncPullResult>): number =>
  page.transactions.reduce((sum, group) => sum + group.changes.length, 0);

export function* snapshotRows(counts: FixtureCounts): Generator<SnapshotRow> {
  for (let index = 0; index < counts.categories; index += 1) {
    const row = categoryRow(index);
    yield { entity: "category", entityId: row.id, rowVersion: row.rowVersion, row };
  }
  for (let index = 0; index < counts.products; index += 1) {
    const row = productRow(counts, index);
    yield { entity: "product", entityId: row.id, rowVersion: row.rowVersion, row };
  }
  for (let index = 0; index < counts.batches; index += 1) {
    const row = batchRow(index);
    yield { entity: "batch", entityId: row.id, rowVersion: row.rowVersion, row };
  }
  for (let index = 0; index < counts.invoices; index += 1) {
    const bundle = invoiceBundle(counts, index);
    yield {
      entity: "invoice",
      entityId: bundle.invoice.id,
      rowVersion: bundle.invoice.rowVersion,
      row: bundle.invoice,
    };
    for (const item of bundle.items) {
      yield { entity: "invoiceItem", entityId: item.id, rowVersion: item.rowVersion, row: item };
    }
    for (const movement of bundle.movements) {
      yield { entity: "stockMovement", entityId: movement.id, rowVersion: 1, row: movement };
    }
  }
  for (let index = 0; index < counts.batches; index += 1) {
    const movement = stockInMovement(index);
    yield { entity: "stockMovement", entityId: movement.id, rowVersion: 1, row: movement };
  }
}
