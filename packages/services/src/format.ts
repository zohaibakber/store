const currency = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" });

export const formatPrice = (paisa: number | null) =>
  paisa === null ? "—" : currency.format(paisa / 100);

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
