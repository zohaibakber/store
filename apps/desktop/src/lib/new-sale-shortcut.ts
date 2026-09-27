export type NewSaleShortcut = {
  readonly label: string;
  readonly ariaKeyShortcuts: string;
  readonly matches: (event: KeyboardEvent) => boolean;
};

export const controlNewSaleShortcut: NewSaleShortcut = {
  label: "Ctrl+N",
  ariaKeyShortcuts: "Control+N",
  matches: (event) =>
    event.code === "KeyN" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey,
};

export const altNewSaleShortcut: NewSaleShortcut = {
  label: "Alt+N",
  ariaKeyShortcuts: "Alt+N",
  matches: (event) =>
    event.code === "KeyN" && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey,
};
