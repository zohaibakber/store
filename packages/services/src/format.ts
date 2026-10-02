const rupees = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" });
const rupeesAndPaisa = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatPrice = (paisa: number | null) => {
  if (paisa === null) return "—";
  return (paisa % 100 === 0 ? rupees : rupeesAndPaisa).format(paisa / 100);
};

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
