import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { CatalogRefusal } from "../catalog/refusal";
import { isPositiveInt } from "../schema-primitives";

export const Money = Schema.Natural.pipe(Schema.brand("Money"));
export type Money = typeof Money.Type;
export const isMoney = Schema.is(Money);

const invalidAmount = (message: string) =>
  Result.fail(new CatalogRefusal({ reason: "invalidInput", message }));

const moneyFrom = (amount: number, message: string): Result.Result<Money, CatalogRefusal> =>
  isMoney(amount) ? Result.succeed(amount) : invalidAmount(message);

export const moneyFromRupees = (rupees: number): Result.Result<Money, CatalogRefusal> =>
  Number.isFinite(rupees) && rupees >= 0
    ? moneyFrom(Math.round(rupees * 100), "Sale prices cannot be negative.")
    : invalidAmount("Sale prices cannot be negative.");

export const moneyToRupees = (amount: number): number => amount / 100;

export const noMoney = Money.make(0);

export const roundedMoney = (amount: number): Money | null => {
  const rounded = Math.round(amount);
  return isMoney(rounded) ? rounded : null;
};

export const sumMoney = (amounts: Iterable<Money | null>): Money => {
  let total = 0;
  for (const amount of amounts) total += amount ?? 0;
  return Money.make(total);
};

export const isValidDiscount = (percent: number | null): percent is number =>
  percent != null && percent >= 0 && percent <= 100;

export const discountedPrice = (
  price: Money,
  percent: number,
): Result.Result<Money, CatalogRefusal> =>
  isValidDiscount(percent)
    ? moneyFrom(Math.round(price * (1 - percent / 100)), "Sale prices cannot be negative.")
    : invalidAmount("Discounts must be between 0 and 100 percent.");

export const lineTotal = (quantity: number, price: Money): Result.Result<Money, CatalogRefusal> =>
  isPositiveInt(quantity)
    ? moneyFrom(quantity * price, "This sale is too large to total.")
    : invalidAmount("Quantities must be whole numbers of 1 or more.");

export const invoiceTotal = (
  items: Iterable<{ readonly quantity: number; readonly salePrice: Money }>,
): Result.Result<Money, CatalogRefusal> =>
  Result.gen(function* () {
    let total = 0;
    for (const item of items) total += yield* lineTotal(item.quantity, item.salePrice);
    return yield* moneyFrom(total, "This sale is too large to total.");
  });
