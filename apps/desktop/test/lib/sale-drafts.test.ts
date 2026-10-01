import type { Product } from "@store/contracts";
import { decodeProductId } from "@store/contracts/ids";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { enteredPrice, resolveSaleLine } from "../../src/components/invoices/sale-line";
import {
  activateSaleDraft,
  addSaleProduct,
  closeSaleDraft,
  discardSaleDraft,
  initialSaleDrafts,
  openSaleDraft,
  restoreSaleDraft,
  SaleDrafts,
  setSaleCustomer,
  updateSaleLine,
} from "../../src/lib/sale-drafts";

const panadol = decodeProductId("panadol");
const brufen = decodeProductId("brufen");

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.toCodecJson(SaleDrafts)));
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.toCodecJson(SaleDrafts)));

const restored = (stored: string) => Option.getOrElse(decode(stored), initialSaleDrafts);

const twoSales = () => {
  const first = addSaleProduct(initialSaleDrafts(), 1, panadol, 2);
  const second = openSaleDraft(first);
  return addSaleProduct(
    setSaleCustomer(second, second.activeId, "Ali"),
    second.activeId,
    brufen,
    1,
  );
};

describe("sale drafts", () => {
  it("completing a sale removes exactly that draft and activates its neighbour", () => {
    const state = twoSales();
    const [kept, sold] = state.drafts;
    const next = closeSaleDraft(state, sold!.id);
    expect(next.drafts).toEqual([kept]);
    expect(next.activeId).toBe(kept!.id);
    const last = closeSaleDraft(next, kept!.id);
    expect(last.drafts).toHaveLength(1);
    expect(last.drafts[0]!.lines).toEqual([]);
    expect(last.drafts[0]!.id).not.toBe(kept!.id);
    expect(last.activeId).toBe(last.drafts[0]!.id);
  });

  it("restores a discarded draft where it was, with everything typed into it", () => {
    const state = activateSaleDraft(twoSales(), 1);
    for (const draft of state.drafts) {
      const [discarded, without] = discardSaleDraft(state, draft.id);
      expect(without.drafts).not.toContainEqual(draft);
      expect(restoreSaleDraft(without, discarded!)).toEqual(state);
    }
    const only = addSaleProduct(initialSaleDrafts(), 1, panadol, 3);
    const [discarded, emptied] = discardSaleDraft(only, 1);
    const back = restoreSaleDraft(emptied, discarded!);
    expect(back.drafts).toEqual(only.drafts);
    expect(back.activeId).toBe(1);
    expect(restoreSaleDraft(back, discarded!)).toBe(back);
  });

  it("never hands an open draft a label number or identity that is in use", () => {
    let state = twoSales();
    state = closeSaleDraft(state, 1);
    state = addSaleProduct(openSaleDraft(state), state.sequence, panadol, 1);
    state = addSaleProduct(openSaleDraft(state), state.sequence, brufen, 1);
    const ordinals = state.drafts.map((draft) => draft.ordinal);
    const identities = state.drafts.flatMap((draft) => [
      draft.id,
      ...draft.lines.map((line) => line.key),
    ]);
    expect(new Set(ordinals).size).toBe(ordinals.length);
    expect(new Set(identities).size).toBe(identities.length);
    expect(Option.isSome(decode(encode(state)))).toBe(true);
  });

  it("falls back to one empty draft when stored drafts are not usable", () => {
    const state = twoSales();
    expect(restored(encode(state))).toEqual(state);
    const stored = encode(state);
    const corrupt = [
      "{not json",
      stored.replace(/"activeId":\d+/, '"activeId":99'),
      stored.replace('"quantityUnit":"unit"', '"quantityUnit":"box"'),
      stored.replace(/"drafts":\[.*\]/, '"drafts":[]'),
    ];
    for (const value of corrupt) {
      expect(value).not.toBe(stored);
      expect(restored(value)).toEqual(initialSaleDrafts());
    }
  });

  it("follows the catalog price until the cashier enters one", () => {
    const priced = (unitPrice: number) =>
      // SAFETY: pricing reads only the id, the prices and the pack size of a product.
      ({ id: panadol, unitPrice, retailPrice: unitPrice * 10, unitsPerPack: 10 }) as Product;
    const added = addSaleProduct(initialSaleDrafts(), 1, panadol, 1);
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
