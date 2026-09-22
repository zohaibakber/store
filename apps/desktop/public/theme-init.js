const storageKey = "store-electron-theme";

let preference = "dark";

try {
  const savedPreference = localStorage.getItem(storageKey);
  if (savedPreference === "light" || savedPreference === "dark" || savedPreference === "system") {
    preference = savedPreference;
  }
} catch {}

const theme =
  preference === "system"
    ? matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark"
    : preference;

document.documentElement.classList.add(theme);
document.documentElement.style.colorScheme = theme;
