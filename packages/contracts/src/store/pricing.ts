import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { CatalogRefusal } from "../catalog/refusal";
import { isPositiveInt } from "../schema-primitives";

export const Paisa = Schema.Natural.pipe(Schema.brand("Paisa"));
export type Paisa = typeof Paisa.Type;
export const isPaisa = Schema.is(Paisa);

const invalidAmount = (message: string) =>
  Result.fail(new CatalogRefusal({ reason: "invalidInput", message }));

const paisaFrom = (amount: number, message: string): Result.Result<Paisa, CatalogRefusal> =>
  isPaisa(amount) ? Result.succeed(amount) : invalidAmount(message);

export const rupeesToPaisa = (rupees: number): Result.Result<Paisa, CatalogRefusal> =>
  Number.isFinite(rupees) && rupees >= 0
    ? paisaFrom(Math.round(rupees * 100), "Sale prices cannot be negative.")
    : invalidAmount("Sale prices cannot be negative.");

export const paisaToRupees = (paisa: number): number => paisa / 100;

export const isValidDiscount = (percent: number | null): percent is number =>
  percent != null && percent >= 0 && percent <= 100;

export const discountedPrice = (
  price: Paisa,
  percent: number,
): Result.Result<Paisa, CatalogRefusal> =>
  isValidDiscount(percent)
    ? paisaFrom(Math.round(price * (1 - percent / 100)), "Sale prices cannot be negative.")
    : invalidAmount("Discounts must be between 0 and 100 percent.");

export const lineTotal = (quantity: number, price: Paisa): Result.Result<Paisa, CatalogRefusal> =>
  isPositiveInt(quantity)
    ? paisaFrom(quantity * price, "This sale is too large to total.")
    : invalidAmount("Quantities must be whole numbers of 1 or more.");

export const invoiceTotal = (
  items: Iterable<{ readonly quantity: number; readonly salePrice: Paisa }>,
): Result.Result<Paisa, CatalogRefusal> =>
  Result.gen(function* () {
    let total = 0;
    for (const item of items) total += yield* lineTotal(item.quantity, item.salePrice);
    return yield* paisaFrom(total, "This sale is too large to total.");
  });
