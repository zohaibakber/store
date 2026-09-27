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

const lowMemory = (navigator.deviceMemory ?? 8) <= 4;
const fewCores = (navigator.hardwareConcurrency ?? 8) <= 4;
const reducedTransparency = matchMedia("(prefers-reduced-transparency: reduce)").matches;
if (lowMemory || fewCores || reducedTransparency) {
  document.documentElement.dataset.performance = "lite";
}
