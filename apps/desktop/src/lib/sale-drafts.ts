import { BatchId, ProductId } from "@store/contracts/ids";
import * as Schema from "effect/Schema";

export const MAX_SALE_DRAFTS = 9;
export const AUTO_BATCH = "auto";
export const CATALOG_PRICE = "catalog";

const Sequence = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const SaleDraftLine = Schema.Struct({
  key: Sequence,
  productId: ProductId,
  batchId: Schema.Union([Schema.Literal(AUTO_BATCH), BatchId]),
  quantity: Schema.NullOr(Schema.Finite),
  quantityUnit: Schema.Literals(["unit", "pack"]),
  price: Schema.Union([Schema.Literal(CATALOG_PRICE), Schema.Null, Schema.Finite]),
});
export type SaleDraftLine = typeof SaleDraftLine.Type;

export const SaleDraft = Schema.Struct({
  id: Sequence,
  ordinal: Sequence,
  customerName: Schema.String,
  bulkDiscount: Schema.NullOr(Schema.Finite),
  lines: Schema.Array(SaleDraftLine),
});
export type SaleDraft = typeof SaleDraft.Type;

const SaleDraftsFields = Schema.Struct({
  sequence: Sequence,
  activeId: Sequence,
  drafts: Schema.Array(SaleDraft),
});

const isDistinct = (values: ReadonlyArray<number>) => new Set(values).size === values.length;

const isCoherent = (state: typeof SaleDraftsFields.Type) => {
  const ids = state.drafts.map((draft) => draft.id);
  const keys = state.drafts.flatMap((draft) => draft.lines.map((line) => line.key));
  return (
    ids.length > 0 &&
    ids.includes(state.activeId) &&
    isDistinct([...ids, ...keys]) &&
    isDistinct(state.drafts.map((draft) => draft.ordinal)) &&
    [...ids, ...keys].every((value) => value < state.sequence)
  );
};

export const SaleDrafts = SaleDraftsFields.check(
  Schema.makeFilter((state) => isCoherent(state) || "sale drafts do not describe open sales"),
);
export type SaleDrafts = typeof SaleDrafts.Type;

export type DiscardedSaleDraft = {
  readonly draft: SaleDraft;
  readonly index: number;
  readonly wasActive: boolean;
  readonly placeholderId: number | null;
};

export type SaleLineChanges = Partial<Pick<SaleDraftLine, "batchId" | "quantity" | "price">>;

const emptyDraft = (id: number, ordinal: number): SaleDraft => ({
  id,
  ordinal,
  customerName: "",
  bulkDiscount: 0,
  lines: [],
});

const nextOrdinal = (drafts: ReadonlyArray<SaleDraft>) =>
  drafts.reduce((highest, draft) => Math.max(highest, draft.ordinal), 0) + 1;

export const initialSaleDrafts = (): SaleDrafts => ({
  sequence: 2,
  activeId: 1,
  drafts: [emptyDraft(1, 1)],
});

export const draftHasLines = (draft: SaleDraft) => draft.lines.length > 0;

export const isBlankDraft = (draft: SaleDraft) =>
  !draftHasLines(draft) && draft.customerName.trim() === "";

export const activeSaleDraft = (state: SaleDrafts): SaleDraft =>
  state.drafts.find((draft) => draft.id === state.activeId) ??
  state.drafts[0] ??
  emptyDraft(state.activeId, 1);

export const saleDraftLabel = (draft: SaleDraft) =>
  draft.customerName.trim() || `Sale ${draft.ordinal}`;

export const canOpenSaleDraft = (state: SaleDrafts) =>
  state.drafts.length < MAX_SALE_DRAFTS || state.drafts.some(isBlankDraft);

export const openSaleDraft = (state: SaleDrafts): SaleDrafts => {
  if (isBlankDraft(activeSaleDraft(state))) return state;
  const blank = state.drafts.find(isBlankDraft);
  if (blank) return { ...state, activeId: blank.id };
  if (state.drafts.length >= MAX_SALE_DRAFTS) return state;
  return {
    sequence: state.sequence + 1,
    activeId: state.sequence,
    drafts: [...state.drafts, emptyDraft(state.sequence, nextOrdinal(state.drafts))],
  };
};

export const activateSaleDraft = (state: SaleDrafts, id: number): SaleDrafts =>
  id !== state.activeId && state.drafts.some((draft) => draft.id === id)
    ? { ...state, activeId: id }
    : state;

export const activateSaleDraftAt = (state: SaleDrafts, index: number): SaleDrafts => {
  const draft = state.drafts[index];
  return draft ? activateSaleDraft(state, draft.id) : state;
};

export const cycleSaleDraft = (state: SaleDrafts, step: 1 | -1): SaleDrafts => {
  const count = state.drafts.length;
  const index = state.drafts.findIndex((draft) => draft.id === state.activeId);
  return activateSaleDraftAt(state, (index + step + count) % count);
};

export const closeSaleDraft = (state: SaleDrafts, id: number): SaleDrafts => {
  const index = state.drafts.findIndex((draft) => draft.id === id);
  if (index === -1) return state;
  const drafts = state.drafts.filter((draft) => draft.id !== id);
  if (drafts.length === 0) {
    return {
      sequence: state.sequence + 1,
      activeId: state.sequence,
      drafts: [emptyDraft(state.sequence, 1)],
    };
  }
  if (state.activeId !== id) return { ...state, drafts };
  const neighbour = drafts[index] ?? drafts[index - 1] ?? drafts[0];
  return { ...state, activeId: neighbour?.id ?? state.activeId, drafts };
};

export const discardSaleDraft = (
  state: SaleDrafts,
  id: number,
): [discarded: DiscardedSaleDraft | null, next: SaleDrafts] => {
  const index = state.drafts.findIndex((draft) => draft.id === id);
  const draft = state.drafts[index];
  if (!draft) return [null, state];
  const discarded = {
    draft,
    index,
    wasActive: state.activeId === id,
    placeholderId: state.drafts.length === 1 ? state.sequence : null,
  };
  return [discarded, closeSaleDraft(state, id)];
};

export const restoreSaleDraft = (state: SaleDrafts, discarded: DiscardedSaleDraft): SaleDrafts => {
  const { draft } = discarded;
  const keys = draft.lines.map((line) => line.key);
  const taken = new Set(
    state.drafts.flatMap((open) => [open.id, ...open.lines.map((line) => line.key)]),
  );
  if ([draft.id, ...keys].some((value) => taken.has(value))) return state;
  const placeholder = state.drafts.find(
    (open) => open.id === discarded.placeholderId && isBlankDraft(open),
  );
  const open = state.drafts.filter((candidate) => candidate !== placeholder);
  const restored = open.some((candidate) => candidate.ordinal === draft.ordinal)
    ? { ...draft, ordinal: nextOrdinal(open) }
    : draft;
  const index = Math.min(discarded.index, open.length);
  const activate =
    discarded.wasActive || open.every((candidate) => candidate.id !== state.activeId);
  return {
    sequence: Math.max(state.sequence, draft.id + 1, ...keys.map((key) => key + 1)),
    activeId: activate ? draft.id : state.activeId,
    drafts: [...open.slice(0, index), restored, ...open.slice(index)],
  };
};

const mapDraft = (
  state: SaleDrafts,
  id: number,
  change: (draft: SaleDraft) => SaleDraft,
): SaleDrafts => ({
  ...state,
  drafts: state.drafts.map((draft) => (draft.id === id ? change(draft) : draft)),
});

const mapLine = (
  state: SaleDrafts,
  key: number,
  change: (line: SaleDraftLine) => SaleDraftLine,
): SaleDrafts => ({
  ...state,
  drafts: state.drafts.map((draft) =>
    draft.lines.some((line) => line.key === key)
      ? { ...draft, lines: draft.lines.map((line) => (line.key === key ? change(line) : line)) }
      : draft,
  ),
});

export const addSaleProduct = (
  state: SaleDrafts,
  id: number,
  productId: ProductId,
  quantity: number,
): SaleDrafts => {
  const draft = state.drafts.find((candidate) => candidate.id === id);
  if (!draft) return state;
  const existing = draft.lines.find(
    (line) => line.productId === productId && line.batchId === AUTO_BATCH,
  );
  if (existing) {
    return mapLine(state, existing.key, (line) => ({
      ...line,
      quantity: (line.quantity ?? 0) + quantity,
    }));
  }
  const line: SaleDraftLine = {
    key: state.sequence,
    productId,
    batchId: AUTO_BATCH,
    quantity,
    quantityUnit: "unit",
    price: CATALOG_PRICE,
  };
  return {
    ...mapDraft(state, id, (current) => ({ ...current, lines: [...current.lines, line] })),
    sequence: state.sequence + 1,
  };
};

export const updateSaleLine = (state: SaleDrafts, key: number, changes: SaleLineChanges) =>
  mapLine(state, key, (line) => ({ ...line, ...changes }));

export const setSaleLineUnit = (
  state: SaleDrafts,
  key: number,
  quantityUnit: SaleDraftLine["quantityUnit"],
) => mapLine(state, key, (line) => ({ ...line, quantityUnit, price: CATALOG_PRICE }));

export const removeSaleLine = (state: SaleDrafts, key: number): SaleDrafts => ({
  ...state,
  drafts: state.drafts.map((draft) =>
    draft.lines.some((line) => line.key === key)
      ? { ...draft, lines: draft.lines.filter((line) => line.key !== key) }
      : draft,
  ),
});

export const setSaleCustomer = (state: SaleDrafts, id: number, customerName: string) =>
  mapDraft(state, id, (draft) => ({ ...draft, customerName }));

export const setSaleDiscount = (state: SaleDrafts, id: number, bulkDiscount: number | null) =>
  mapDraft(state, id, (draft) => ({ ...draft, bulkDiscount }));

export const saleProductIds = (state: SaleDrafts): ReadonlyArray<ProductId> =>
  [...new Set(state.drafts.flatMap((draft) => draft.lines.map((line) => line.productId)))].sort();

export type QuantityElsewhere = {
  readonly unit: number;
  readonly pack: number;
  readonly sales: number;
};

export const quantitiesInOtherDrafts = (
  state: SaleDrafts,
  id: number,
): ReadonlyMap<ProductId, QuantityElsewhere> => {
  const totals = new Map<ProductId, QuantityElsewhere>();
  for (const draft of state.drafts) {
    if (draft.id === id) continue;
    const counted = new Set<ProductId>();
    for (const line of draft.lines) {
      const quantity = Math.max(line.quantity ?? 0, 0);
      const current = totals.get(line.productId) ?? { unit: 0, pack: 0, sales: 0 };
      totals.set(line.productId, {
        ...current,
        [line.quantityUnit]: current[line.quantityUnit] + quantity,
        sales: current.sales + (counted.has(line.productId) ? 0 : 1),
      });
      counted.add(line.productId);
    }
  }
  return totals;
};

export const parkedSaleCount = (state: SaleDrafts, onNewSale: boolean) => {
  const count = state.drafts.filter(draftHasLines).length;
  return count > 1 || (count === 1 && !onNewSale) ? count : 0;
};
