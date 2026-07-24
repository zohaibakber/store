import * as React from "react";

export type ThemePreference = "dark" | "light" | "system";
type ResolvedTheme = "dark" | "light";

type ThemeContextValue = {
  /** What the user picked — may be "system". */
  preference: ThemePreference;
  /** What is actually applied right now. */
  theme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider.");
  return context;
}

const isPreference = (value: string | null): value is ThemePreference =>
  value === "light" || value === "dark" || value === "system";

const systemTheme = (): ResolvedTheme =>
  window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";

export function ThemeProvider({
  children,
  defaultTheme = "dark",
  storageKey = "store-electron-theme",
}: {
  children: React.ReactNode;
  defaultTheme?: ThemePreference;
  storageKey?: string;
}) {
  const [preference, setPreference] = React.useState<ThemePreference>(() => {
    const saved = localStorage.getItem(storageKey);
    return isPreference(saved) ? saved : defaultTheme;
  });
  const [resolvedSystem, setResolvedSystem] = React.useState<ResolvedTheme>(systemTheme);

  // Only worth tracking while the user is actually on "system".
  React.useEffect(() => {
    if (preference !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setResolvedSystem(systemTheme());
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  const theme: ResolvedTheme = preference === "system" ? resolvedSystem : preference;

  React.useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    root.style.colorScheme = theme;
  }, [theme]);

  const setTheme = React.useCallback(
    (next: ThemePreference) => {
      localStorage.setItem(storageKey, next);
      setPreference(next);
    },
    [storageKey],
  );

  const value = React.useMemo(
    () => ({ preference, setTheme, theme }),
    [preference, setTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
