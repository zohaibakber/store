// @vitest-environment happy-dom
import { decodeProductId } from "@store/contracts";
import {
  DEFAULT_STOCK_POLICY,
  StockRecommendationService,
  stockRecommendationLayer,
  type StockPolicy,
} from "@store/services/stock-recommendations";
import { fireEvent, screen } from "@testing-library/react";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { expect, test } from "vitest";

import { StockRecommendations } from "@/components/dashboard/stock-recommendations";
import { stockBuyListCsv } from "@/lib/inventory/stock-buy-list";

import { batch, dailySales, now, product } from "../../../../packages/services/test/stock-fixtures";
import { renderWithRouter } from "../lib/render";

const analyze = (policy = DEFAULT_STOCK_POLICY) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(now);
      const service = yield* StockRecommendationService;
      return yield* service.analyze({
        organizationId: "org",
        policy,
        products: [
          { ...product, name: "Fast seller", batches: [batch(85)] },
          { ...product, id: decodeProductId("empty"), name: "Empty product" },
          {
            ...product,
            id: decodeProductId("slow"),
            name: "Slow product",
            batches: [{ ...batch(500), productId: decodeProductId("slow") }],
          },
        ],
        invoices: dailySales,
      });
    }).pipe(Effect.provide(stockRecommendationLayer), Effect.provide(TestClock.layer())),
  );

test("renders the Effect report and composes stock filters with search", async () => {
  const report = await analyze();
  renderWithRouter(
    <StockRecommendations
      state={{ _tag: "Ready", report }}
      policy={DEFAULT_STOCK_POLICY}
      onPolicyChange={() => undefined}
    />,
  );
  expect(screen.getByText("Suggested buy: 32 packs")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Fast seller" }).getAttribute("href")).toBe(
    "/products/product",
  );
  fireEvent.click(screen.getByRole("button", { name: "Out of stock (1)" }));
  expect(screen.getByText("Empty product")).toBeTruthy();
  expect(screen.queryByText("Fast seller")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Buy list (1)" }));
  expect(screen.getByText("Fast seller")).toBeTruthy();
  expect(screen.queryByText("Empty product")).toBeNull();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "absent" } });
  expect(screen.getByText("No products match this view.")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Slow moving (1)" }));
  expect(screen.getByText("Slow product")).toBeTruthy();
  expect(screen.getByText(/Hold off buying/)).toBeTruthy();
});

test("planning edits reach the Effect policy boundary, including invalid inputs", async () => {
  const report = await analyze();
  let submitted: StockPolicy = DEFAULT_STOCK_POLICY;
  renderWithRouter(
    <StockRecommendations
      state={{ _tag: "Ready", report }}
      policy={DEFAULT_STOCK_POLICY}
      onPolicyChange={(policy) => {
        submitted = policy;
      }}
    />,
  );
  const field = screen.getByRole("spinbutton", { name: "Delivery time (days)", hidden: true });
  fireEvent.change(field, { target: { value: "20" } });
  fireEvent.blur(field);
  expect(submitted.leadDays).toBe(20);
  const updated = await analyze(submitted);
  expect(
    updated.recommendations.find((row) => row.productName === "Fast seller")?.orderQuantity,
  ).toBe(45);
  fireEvent.change(field, { target: { value: "" } });
  fireEvent.blur(field);
  expect(Number.isNaN(submitted.leadDays)).toBe(true);
});

test("pending and failed reports cannot expose a stale buy list", () => {
  const { rerender } = renderWithRouter(
    <StockRecommendations
      state={{ _tag: "Loading" }}
      policy={DEFAULT_STOCK_POLICY}
      onPolicyChange={() => undefined}
    />,
  );
  expect(screen.getByRole("button", { name: "Export buy list (0)" }).hasAttribute("disabled")).toBe(
    true,
  );
  expect(screen.getByRole("status").textContent).toContain("Calculating");
  rerender(
    <StockRecommendations
      state={{ _tag: "Error", message: "Check the stock planning values." }}
      policy={DEFAULT_STOCK_POLICY}
      onPolicyChange={() => undefined}
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain("Check the stock planning values");
  expect(screen.getByRole("button", { name: "Export buy list (0)" }).hasAttribute("disabled")).toBe(
    true,
  );
});

test("buy-list CSV exports the full suggested quantities and escapes spreadsheet formulas", async () => {
  const report = await analyze();
  expect(stockBuyListCsv(report.recommendations)).toContain('"32","packs","320"');
  expect(stockBuyListCsv(report.recommendations)).not.toContain("Empty product");
  const rows = report.recommendations.map((row) => ({ ...row, productName: '=SUM(1,2)"' }));
  expect(stockBuyListCsv(rows)).toContain('"\'=SUM(1,2)"""');
});
