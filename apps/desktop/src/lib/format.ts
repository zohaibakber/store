import { format } from "date-fns";

const currency = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" });

// Prices are stored in the smallest currency unit (paisa).
export const formatPrice = (value: number | null) =>
  value == null ? "—" : currency.format(value / 100);

export const formatDate = (value: number) => format(value, "d MMM yyyy");
