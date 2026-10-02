const QUANTITY_PREFIX = /^\s*(\d{1,4})\s*(?:\*|[x×](?=\s|$))\s*(.*)$/iu;

export interface SaleQuery {
  readonly quantity: number;
  readonly term: string;
}

export const parseSaleQuery = (input: string): SaleQuery => {
  const match = QUANTITY_PREFIX.exec(input);
  const quantity = match ? Number(match[1]) : 1;
  if (!match || quantity < 1) return { quantity: 1, term: input.trim() };
  return { quantity, term: (match[2] ?? "").trim() };
};
