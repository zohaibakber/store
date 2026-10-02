// @vitest-environment happy-dom
import type { Product } from "@store/contracts";
import { decodeInvoiceId, decodeProductId } from "@store/contracts/ids";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { beforeEach, describe, expect, it } from "vitest";

import { enteredPrice, resolveSaleLine } from "../../src/components/invoices/sale-line";
import { saleDraftStore } from "../../src/hooks/use-sale-drafts";
import { saleDraftsAtom } from "../../src/lib/preferences";
import {
  addSaleProduct,
  closeSaleDraft,
  initialSaleDrafts,
  openSaleDraft,
  SaleDrafts,
  setSaleCustomer,
  updateSaleLine,
} from "../../src/lib/sale-drafts";

const panadol = decodeProductId("panadol");
const brufen = decodeProductId("brufen");
const first = decodeInvoiceId("sale-first");
const second = decodeInvoiceId("sale-second");
const third = decodeInvoiceId("sale-third");
const spare = decodeInvoiceId("sale-spare");

const WORKSPACE = "local";
const STORAGE_KEY = `store.sale-drafts.${WORKSPACE}`;

const codec = Schema.fromJsonString(Schema.toCodecJson(SaleDrafts));
const decode = Schema.decodeUnknownOption(codec);
const encode = Schema.encodeSync(codec);

const twoSales = () => {
  const one = addSaleProduct(initialSaleDrafts(first), first, panadol, 2);
  return addSaleProduct(
    setSaleCustomer(openSaleDraft(one, second), second, "Ali"),
    second,
    brufen,
    1,
  );
};

const context = () => {
  const registry = AtomRegistry.make();
  const atom = saleDraftsAtom(WORKSPACE);
  registry.mount(atom);
  return {
    store: saleDraftStore(registry, WORKSPACE),
    state: () => registry.get(atom),
    ids: () => registry.get(atom).drafts.map((draft) => draft.id),
  };
};

const stored = () => Option.getOrThrow(decode(localStorage.getItem(STORAGE_KEY)));

const announceStorage = () =>
  window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));

describe("sale drafts", () => {
  beforeEach(() => localStorage.clear());

  it("completing a sale removes exactly that draft and activates its neighbour", () => {
    const state = twoSales();
    const [kept, sold] = state.drafts;
    const next = closeSaleDraft(state, sold!.id, spare);
    expect(next.drafts).toEqual([kept]);
    expect(next.activeId).toBe(kept!.id);
    const last = closeSaleDraft(next, kept!.id, spare);
    expect(last.drafts).toHaveLength(1);
    expect(last.drafts[0]!.lines).toEqual([]);
    expect(last.drafts[0]!.id).toBe(spare);
    expect(last.activeId).toBe(spare);
  });

  it("never hands an open draft a label number or line identity that is in use", () => {
    let state = closeSaleDraft(twoSales(), first, spare);
    state = addSaleProduct(openSaleDraft(state, third), third, panadol, 1);
    state = addSaleProduct(openSaleDraft(state, first), first, brufen, 1);
    const ordinals = state.drafts.map((draft) => draft.ordinal);
    const keys = state.drafts.flatMap((draft) => draft.lines.map((line) => line.key));
    expect(new Set(ordinals).size).toBe(ordinals.length);
    expect(new Set(keys).size).toBe(keys.length);
    expect(Option.isSome(decode(encode(state)))).toBe(true);
  });

  it("starts from one empty draft when stored drafts are not usable", () => {
    const valid = encode(twoSales());
    localStorage.setItem(STORAGE_KEY, valid);
    expect(context().state()).toEqual(twoSales());
    const corrupt = [
      "{not json",
      valid.replace(/"activeId":"[^"]+"/, '"activeId":"sale-unknown"'),
      valid.replace('"quantityUnit":"unit"', '"quantityUnit":"box"'),
      valid.replace(/"drafts":\[.*\]/, '"drafts":[]'),
    ];
    for (const value of corrupt) {
      expect(value).not.toBe(valid);
      localStorage.setItem(STORAGE_KEY, value);
      const state = context().state();
      expect(state.drafts).toHaveLength(1);
      expect(state.drafts[0]!.lines).toEqual([]);
      expect(stored()).toEqual(state);
    }
  });

  it("never writes a completed sale back from another window's stale copy", () => {
    localStorage.setItem(STORAGE_KEY, encode(twoSales()));
    const till = context();
    const stale = context();
    expect(stale.ids()).toEqual([first, second]);

    expect(till.store.complete(second)).toBe(true);
    expect(stale.ids()).toEqual([first, second]);

    stale.store.update((state) => setSaleCustomer(state, second, "Ali again"));
    stale.store.update((state) => addSaleProduct(state, second, panadol, 5));
    expect(stored().drafts.map((draft) => draft.id)).toEqual([first]);

    stale.store.update((state) => setSaleCustomer(state, first, "Sara"));
    expect(stale.ids()).toEqual([first]);
    expect(stored().drafts).toEqual([{ ...twoSales().drafts[0], customerName: "Sara" }]);

    till.store.update((state) => addSaleProduct(state, first, brufen, 1));
    expect(till.state().drafts[0]!.customerName).toBe("Sara");
    const keys = stored().drafts[0]!.lines.map((line) => line.key);
    expect(new Set(keys).size).toBe(2);

    announceStorage();
    expect(stale.state()).toEqual(till.state());
    expect(stale.state()).toEqual(stored());
  });

  it("drops a draft whose invoice the catalog already holds, and only that draft", async () => {
    localStorage.setItem(STORAGE_KEY, encode(twoSales()));
    const till = context();
    till.store.dropIssued([{ id: second, invoiceNumber: 12 }]);
    expect(till.ids()).toEqual([first]);
    expect(stored().drafts.map((draft) => draft.id)).toEqual([first]);
    let attempts = 0;
    await till.store.whileCompleting(first, async () => {
      attempts += 1;
      await till.store.whileCompleting(first, async () => {
        attempts += 1;
      });
      till.store.dropIssued([{ id: first, invoiceNumber: 13 }]);
      till.store.discard(first);
      expect(till.ids()).toEqual([first]);
    });
    expect(attempts).toBe(1);
    expect(till.store.complete(first)).toBe(false);
    expect(till.state().drafts[0]!.lines).toEqual([]);
  });

  it("follows the catalog price until the cashier enters one", () => {
    const priced = (unitPrice: number) =>
      // SAFETY: pricing reads only the id, the prices and the pack size of a product.
      ({ id: panadol, unitPrice, retailPrice: unitPrice * 10, unitsPerPack: 10 }) as Product;
    const added = addSaleProduct(initialSaleDrafts(first), first, panadol, 1);
    const key = added.drafts[0]!.lines[0]!.key;
    const priceOf = (state: SaleDrafts, product: Product) => {
      const line = resolveSaleLine(state.drafts[0]!.lines[0]!, () => product);
      return line.kind === "ready" ? line.salePrice : undefined;
    };
    expect(priceOf(added, priced(100))).toBe(1);
    expect(priceOf(added, priced(300))).toBe(3);
    const edited = updateSaleLine(added, key, { price: enteredPrice(priced(100), "unit", 2) });
    expect(priceOf(edited, priced(300))).toBe(2);
    const typedBack = updateSaleLine(edited, key, { price: enteredPrice(priced(100), "unit", 1) });
    expect(priceOf(typedBack, priced(300))).toBe(3);
  });
});
