export const newSaleShortcut = {
  label: "Ctrl+N",
  ariaKeyShortcuts: "Control+N",
  matches: (event: KeyboardEvent) =>
    event.code === "KeyN" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey,
};
