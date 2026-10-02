import { useEffect, useRef } from "react";

const POPUP_SELECTOR = "[role=dialog], [role=alertdialog], [role=listbox], [role=menu]";

export const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.closest("input, textarea, select, [role=combobox]") !== null);

const NOT_IN_THE_WAY = "[hidden], [data-slot^=toast-viewport]";

const isInTheWay = (element: Element) => element.closest(NOT_IN_THE_WAY) === null;

const hasShown = (selector: string) =>
  Array.from(document.querySelectorAll(selector)).some(isInTheWay);

export const hasOpenPopup = () => hasShown(POPUP_SELECTOR);

const MODAL_SELECTOR = "[role=dialog], [role=alertdialog], [role=menu]";

export const hasOpenModal = () => hasShown(MODAL_SELECTOR);

export const isInListbox = (target: EventTarget | null) =>
  target instanceof Element && target.closest("[role=listbox]") !== null;

export const isSubmitChord = (
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">,
) => event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey;

export function useWindowKeydown(handler: (event: KeyboardEvent) => void, capture = false): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => latest.current(event);
    window.addEventListener("keydown", listener, capture);
    return () => window.removeEventListener("keydown", listener, capture);
  }, [capture]);
}

export function usePageShortcuts(
  bindings: Readonly<Record<string, (() => void) | undefined>>,
): void {
  useWindowKeydown((event) => {
    if (event.defaultPrevented || event.repeat) return;
    if (isEditableTarget(event.target)) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    const run = Object.hasOwn(bindings, key) ? bindings[key] : undefined;
    if (run === undefined) return;
    if (hasOpenPopup()) return;
    event.preventDefault();
    run();
  });
}

export function useSubmitShortcut(submit: () => void): void {
  useWindowKeydown((event) => {
    if (!isSubmitChord(event)) return;
    if (event.defaultPrevented || event.repeat) return;
    event.preventDefault();
    submit();
  });
}
