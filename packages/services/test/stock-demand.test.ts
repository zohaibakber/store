import { expect, test } from "vitest";

import { forecastDemand } from "../src/stock-recommendations/demand";

test("constant demand has zero held-out error and prefers the longer average on ties", () => {
  expect(
    forecastDemand(
      Array.from({ length: 90 }, () => 10),
      90,
    ),
  ).toEqual({ dailyDemand: 10, forecastDays: 30, backtestError: 0 });
});

test("a sustained recent change selects the shorter average using past prediction errors", () => {
  const sales = Array.from({ length: 90 }, (_, i) => (i < 21 ? 20 : 2));
  expect(forecastDemand(sales, 90)).toEqual({ dailyDemand: 20, forecastDays: 7, backtestError: 0 });
});

test("the held-out sale is not included in its own forecast", () => {
  const sales = [1000, ...Array.from({ length: 89 }, () => 10)];
  expect(forecastDemand(sales, 90)).toEqual({
    dailyDemand: 43,
    forecastDays: 30,
    backtestError: 990 / 14,
  });
});

test("short history uses observed days and does not claim a backtest", () => {
  expect(forecastDemand([12, 8], 2)).toEqual({
    dailyDemand: 10,
    forecastDays: 30,
    backtestError: null,
  });
  expect(forecastDemand([], 43)).toEqual({ dailyDemand: 0, forecastDays: 30, backtestError: null });
});
