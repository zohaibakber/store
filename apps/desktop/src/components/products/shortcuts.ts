import { useEffect, useRef } from "react";

const POPUP_SELECTOR = "[role=dialog], [role=alertdialog], [role=listbox], [role=menu]";

export const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.closest("input, textarea, select, [role=combobox]") !== null);

const isShown = (element: Element) => element.closest("[hidden]") === null;

const hasShown = (selector: string) =>
  Array.from(document.querySelectorAll(selector)).some(isShown);

export const hasOpenPopup = () => hasShown(POPUP_SELECTOR);

const MODAL_SELECTOR = "[role=dialog], [role=alertdialog], [role=menu]";

export const hasOpenModal = () => hasShown(MODAL_SELECTOR);

export const isInListbox = (target: EventTarget | null) =>
  target instanceof Element && target.closest("[role=listbox]") !== null;

export const isPlainKey = (event: KeyboardEvent, key: string) =>
  event.key.toLowerCase() === key &&
  !event.ctrlKey &&
  !event.metaKey &&
  !event.altKey &&
  !event.shiftKey;

export function useWindowKeydown(handler: (event: KeyboardEvent) => void, capture = false) {
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
