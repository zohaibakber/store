import { decodeInvoiceId, ProductId, type InvoiceId, type StaffId } from "@store/contracts/ids";
import { browserStorage, preferencesRuntime } from "@store/inventory-react";
import * as Option from "effect/Option";
import * as Atom from "effect/reactivity/Atom";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { DEFAULT_RECEIPT_FORMAT, ReceiptFormat } from "@/lib/receipt-format";
import {
  adoptSaleDrafts,
  initialSaleDrafts,
  saleDraftMemberKeyPrefix,
  saleDraftOwnerKey,
  SaleDrafts,
  type SaleDraftOwner,
} from "@/lib/sale-drafts";

const THEME_KEY = "store-electron-theme";

export const upgradeBareThemePreference = () => {
  const storage = browserStorage();
  if (storage === null) return;
  const stored = storage.getItem(THEME_KEY);
  if (stored === "dark" || stored === "light" || stored === "system") {
    storage.setItem(THEME_KEY, JSON.stringify(stored));
  }
};

const ThemePreferenceSchema = Schema.Literals(["dark", "light", "system"]);
export type ThemePreference = typeof ThemePreferenceSchema.Type;

export const themePreferenceAtom = Atom.kvs({
  runtime: preferencesRuntime,
  key: THEME_KEY,
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

type Held<A> = { readonly text: string | null; readonly value: A };

const sharedAtom = <A, I>(options: {
  readonly key: string;
  readonly schema: Schema.Codec<A, I>;
  readonly defaultValue: () => A;
}): Atom.Writable<A, (current: A) => A> => {
  const json = Schema.fromJsonString(Schema.toCodecJson(options.schema));
  const decode = Schema.decodeUnknownOption(json);
  const encode = Schema.encodeOption(json);
  const storedText = () => browserStorage()?.getItem(options.key) ?? null;

  const persist = (value: A): Held<A> => {
    const storage = browserStorage();
    const text = Option.getOrNull(encode(value));
    if (storage !== null && text !== null) Result.try(() => storage.setItem(options.key, text));
    return { text: storedText(), value };
  };

  const latest = (held: Option.Option<Held<A>>): Held<A> => {
    const text = storedText();
    if (Option.isSome(held) && held.value.text === text) return held.value;
    return Option.fromNullishOr(text).pipe(
      Option.flatMap(decode),
      Option.match({
        onNone: () => persist(options.defaultValue()),
        onSome: (value) => ({ text, value }),
      }),
    );
  };

  const held: Atom.Writable<Held<A>, (current: A) => A> = Atom.writable(
    (get) => {
      const adopt = (event: StorageEvent) => {
        if (event.key === null || event.key === options.key) {
          get.setSelf(latest(get.self<Held<A>>()));
        }
      };
      window.addEventListener("storage", adopt);
      get.addFinalizer(() => window.removeEventListener("storage", adopt));
      return latest(get.self<Held<A>>());
    },
    (ctx, change) => {
      const current = latest(Option.some(ctx.get(held)));
      const next = change(current.value);
      ctx.setSelf(next === current.value ? current : persist(next));
    },
  );

  return Atom.writable(
    (get) => get(held).value,
    (ctx, change) => ctx.set(held, change),
  );
};

export const newSaleId = (): InvoiceId => decodeInvoiceId(crypto.randomUUID());

const SALE_DRAFTS_KEY = "store.sale-drafts.";

type SaleDraftsAtom = Atom.Writable<SaleDrafts, (current: SaleDrafts) => SaleDrafts>;

const blankSaleDrafts = () => initialSaleDrafts(newSaleId());

const storedSaleDraftsAtom = Atom.family((key: string): SaleDraftsAtom =>
  sharedAtom({
    key: `${SALE_DRAFTS_KEY}${key}`,
    schema: SaleDrafts,
    defaultValue: blankSaleDrafts,
  }).pipe(Atom.keepAlive),
);

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
