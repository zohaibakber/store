import { moneyToRupees } from "@store/contracts/store-pricing";

const rupees = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" });
const rupeesWithFraction = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatPrice = (amount: number | null) => {
  if (amount === null) return "—";
  return (amount % 100 === 0 ? rupees : rupeesWithFraction).format(moneyToRupees(amount));
};

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
