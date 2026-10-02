import { useAtom, useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as React from "react";

import { appHost } from "@/host";
import { themePreferenceAtom, type ThemePreference } from "@/lib/preferences";

type ResolvedTheme = "dark" | "light";

type ThemeContextValue = {
  preference: ThemePreference;
  theme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider.");
  return context;
}

const systemTheme = (): ResolvedTheme =>
  window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";

const systemThemeAtom = Atom.make((get) => {
  const query = window.matchMedia("(prefers-color-scheme: light)");
  const onChange = () => get.refreshSelf();
  query.addEventListener("change", onChange);
  get.addFinalizer(() => query.removeEventListener("change", onChange));
  return systemTheme();
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setTheme] = useAtom(themePreferenceAtom);
  const resolvedSystem = useAtomValue(systemThemeAtom);
  const theme: ResolvedTheme = preference === "system" ? resolvedSystem : preference;

  React.useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    root.style.colorScheme = theme;
  }, [theme]);

  React.useEffect(() => {
    appHost().theme?.setSource(preference);
  }, [preference]);

  const value = React.useMemo(
    () => ({ preference, setTheme, theme }),
    [preference, setTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
