import { MAX_SALE_DRAFTS } from "@/lib/sale-drafts";

type SaleDraftShortcut =
  | { readonly _tag: "Jump"; readonly index: number }
  | { readonly _tag: "Cycle"; readonly step: 1 | -1 }
  | { readonly _tag: "Discard" };

type ShortcutKey = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

const DIGIT = /^Digit([1-9])$/;

export type ShortcutFocus = "page" | "emptyField" | "field";

export const saleDraftShortcut = (
  event: ShortcutKey,
  focus: ShortcutFocus,
): SaleDraftShortcut | null => {
  const command = event.ctrlKey || event.metaKey;
  if (event.altKey && !command && !event.shiftKey) {
    const digit = DIGIT.exec(event.code)?.[1];
    if (digit === undefined || Number(digit) > MAX_SALE_DRAFTS) return null;
    if (focus !== "page" && event.key !== digit) return null;
    return { _tag: "Jump", index: Number(digit) - 1 };
  }
  if (event.altKey) return null;
  if (event.key === "Tab" && event.ctrlKey && !event.metaKey) {
    return { _tag: "Cycle", step: event.shiftKey ? -1 : 1 };
  }
  if (event.code === "KeyW" && command && !event.shiftKey && focus !== "field") {
    return { _tag: "Discard" };
  }
  return null;
};
