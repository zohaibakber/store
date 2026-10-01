import { MAX_SALE_DRAFTS } from "@/lib/sale-drafts";

export type SaleDraftShortcut =
  | { readonly _tag: "Jump"; readonly index: number }
  | { readonly _tag: "Cycle"; readonly step: 1 | -1 }
  | { readonly _tag: "Discard" };

type ShortcutKey = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

const DIGIT = /^Digit([1-9])$/;

export const saleDraftShortcut = (event: ShortcutKey): SaleDraftShortcut | null => {
  const command = event.ctrlKey || event.metaKey;
  if (event.altKey && !command && !event.shiftKey) {
    const digit = Number(DIGIT.exec(event.code)?.[1]);
    return digit >= 1 && digit <= MAX_SALE_DRAFTS ? { _tag: "Jump", index: digit - 1 } : null;
  }
  if (event.altKey) return null;
  if (event.key === "Tab" && event.ctrlKey && !event.metaKey) {
    return { _tag: "Cycle", step: event.shiftKey ? -1 : 1 };
  }
  if (event.code === "KeyW" && command && !event.shiftKey) return { _tag: "Discard" };
  return null;
};
