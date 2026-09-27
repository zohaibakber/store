export type NewSaleShortcut = {
  readonly label: string;
  readonly ariaKeyShortcuts: string;
  readonly matches: (event: KeyboardEvent) => boolean;
};

/** Electron also owns Ctrl/⌘+N through its menu accelerator. */
export const controlNewSaleShortcut: NewSaleShortcut = {
  label: "Ctrl+N",
  ariaKeyShortcuts: "Control+N",
  matches: (event) =>
    event.code === "KeyN" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey,
};

/** Browsers reserve Ctrl/⌘+N for a new window and never deliver it to the page. */
export const altNewSaleShortcut: NewSaleShortcut = {
  label: "Alt+N",
  ariaKeyShortcuts: "Alt+N",
  matches: (event) =>
    event.code === "KeyN" && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey,
};
