import { decodeInvoiceId, ProductId, type InvoiceId, type StaffId } from "@store/contracts";
import * as Atom from "effect/reactivity/Atom";
import * as Schema from "effect/Schema";

import { browserStorage, preferencesRuntime } from "@/inventory/preferences";
import { DEFAULT_RECEIPT_FORMAT, ReceiptFormat } from "@/lib/receipt-format";
import {
  adoptSaleDrafts,
  initialSaleDrafts,
  saleDraftMemberKeyPrefix,
  saleDraftOwnerKey,
  SaleDrafts,
  type SaleDraftOwner,
} from "@/lib/sale-drafts";

const ThemePreferenceSchema = Schema.Literals(["dark", "light", "system"]);
export type ThemePreference = typeof ThemePreferenceSchema.Type;

export const themePreferenceAtom = Atom.kvs({
  runtime: preferencesRuntime,
  key: "store-electron-theme",
  schema: ThemePreferenceSchema,
  defaultValue: (): ThemePreference => "dark",
}).pipe(Atom.keepAlive);

export const sidebarOpenAtom = Atom.kvs({
  runtime: preferencesRuntime,
  key: "store.sidebar-open",
  schema: Schema.Boolean,
  defaultValue: () => false,
}).pipe(Atom.keepAlive);

const RecentProductSchema = Schema.Struct({
  id: ProductId,
  name: Schema.String,
  strength: Schema.NullOr(Schema.String),
  categoryName: Schema.String,
});

export type RecentProduct = typeof RecentProductSchema.Type;

export const recentProductsAtom = Atom.family((workspace: string) =>
  Atom.kvs({
    runtime: preferencesRuntime,
    key: `store.recent-products.${workspace}`,
    schema: Schema.Array(RecentProductSchema),
    defaultValue: (): ReadonlyArray<RecentProduct> => [],
  }).pipe(Atom.keepAlive),
);

export const receiptFormatAtom = Atom.family((workspace: string) =>
  Atom.kvs({
    runtime: preferencesRuntime,
    key: `store.receipt-format.${workspace}`,
    schema: ReceiptFormat,
    defaultValue: (): ReceiptFormat => DEFAULT_RECEIPT_FORMAT,
  }).pipe(Atom.keepAlive),
);

export const newSaleId = (): InvoiceId => decodeInvoiceId(crypto.randomUUID());

const SALE_DRAFTS_KEY = "store.sale-drafts.";

type SaleDraftsAtom = Atom.Writable<SaleDrafts, (current: SaleDrafts) => SaleDrafts>;

const blankSaleDrafts = () => initialSaleDrafts(newSaleId());

const storedSaleDraftsAtom = Atom.family((key: string): SaleDraftsAtom => {
  const stored = Atom.kvs({
    runtime: preferencesRuntime,
    key: `${SALE_DRAFTS_KEY}${key}`,
    schema: SaleDrafts,
    defaultValue: blankSaleDrafts,
  }).pipe(Atom.keepAlive);
  return Atom.writable<SaleDrafts, (current: SaleDrafts) => SaleDrafts>(
    (get) => get(stored),
    (ctx, change) => ctx.set(stored, change(ctx.get(stored))),
  ).pipe(Atom.keepAlive);
});

const adoptingSaleDraftsAtom = Atom.family((workspace: string) =>
  Atom.family((member: StaffId): SaleDraftsAtom => {
    const own = storedSaleDraftsAtom(saleDraftOwnerKey(workspace, member));
    const unowned = storedSaleDraftsAtom(workspace);
    return Atom.writable(
      (get) => adoptSaleDrafts(get(own), get(unowned)),
      (ctx, change) => {
        const loose = ctx.get(unowned);
        let adopted = false;
        ctx.set(own, (current) => {
          const from = adoptSaleDrafts(current, loose);
          adopted = from !== current;
          return change(from);
        });
        if (adopted) ctx.set(unowned, blankSaleDrafts);
      },
    );
  }),
);

export const saleDraftsAtom = ({ workspace, member }: SaleDraftOwner): SaleDraftsAtom => {
  if (member === null) return storedSaleDraftsAtom(workspace);
  return member.role === "owner"
    ? adoptingSaleDraftsAtom(workspace)(member.id)
    : storedSaleDraftsAtom(saleDraftOwnerKey(workspace, member.id));
};

export const storedSaleDraftAtoms = (workspace: string): ReadonlyArray<SaleDraftsAtom> => {
  const storage = browserStorage();
  const members = `${SALE_DRAFTS_KEY}${saleDraftMemberKeyPrefix(workspace)}`;
  const stored = storage === null ? [] : Object.keys(storage);
  return [
    workspace,
    ...stored
      .filter((key) => key.startsWith(members))
      .map((key) => key.slice(SALE_DRAFTS_KEY.length)),
  ].map(storedSaleDraftsAtom);
};

export const publishOfferDismissedAtom = Atom.kvs({
  runtime: preferencesRuntime,
  key: "store.publish-offer-dismissed",
  schema: Schema.Array(Schema.String),
  defaultValue: (): ReadonlyArray<string> => [],
}).pipe(Atom.keepAlive);

export const acknowledgedRejectionsAtom = Atom.kvs({
  runtime: preferencesRuntime,
  key: "store.acknowledged-rejections",
  schema: Schema.Array(Schema.String),
  defaultValue: (): ReadonlyArray<string> => [],
}).pipe(Atom.keepAlive);
