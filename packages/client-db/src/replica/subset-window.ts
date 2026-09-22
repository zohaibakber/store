import type { LoadSubsetOptions } from "@tanstack/db";
import { IR } from "@tanstack/db";

type ExpressionKey =
  | { readonly t: "ref"; readonly p: ReadonlyArray<PropertyKey> }
  | { readonly t: "val"; readonly v: unknown }
  | { readonly t: "func"; readonly n: string; readonly a: ReadonlyArray<ExpressionKey> }
  | { readonly t: "x" };

const expressionKey = (expression: IR.BasicExpression): ExpressionKey => {
  if (expression.type === "ref") return { t: "ref", p: expression.path };
  if (expression.type === "val") return { t: "val", v: expression.value };
  if (expression.type === "func") {
    return { t: "func", n: expression.name, a: expression.args.map(expressionKey) };
  }
  return { t: "x" };
};

export const subsetWindowKey = (options: LoadSubsetOptions): string =>
  JSON.stringify({
    where: options.where ? expressionKey(options.where) : null,
    orderBy: options.orderBy?.map((clause) => ({
      e: expressionKey(clause.expression),
      d: clause.compareOptions.direction,
    })),
    limit: options.limit ?? null,
    offset: options.offset ?? null,
    cursor: options.cursor ? expressionKey(options.cursor.whereFrom) : null,
  });
