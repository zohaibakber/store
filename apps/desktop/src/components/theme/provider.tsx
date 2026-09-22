import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as React from "react";

export type ThemePreference = "dark" | "light" | "system";
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

const ThemePreferenceSchema = Schema.Literals(["dark", "light", "system"]);

const readStoredPreference = (storageKey: string, fallback: ThemePreference): ThemePreference =>
  Schema.decodeUnknownOption(ThemePreferenceSchema)(localStorage.getItem(storageKey)).pipe(
    Option.getOrElse(() => fallback),
  );

const systemTheme = (): ResolvedTheme =>
  window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";

/** matchMedia subscription owned by Atom finalizers instead of a React effect. */
const systemThemeAtom = Atom.make((get) => {
  const query = window.matchMedia("(prefers-color-scheme: light)");
  const onChange = () => get.refreshSelf();
  query.addEventListener("change", onChange);
  get.addFinalizer(() => query.removeEventListener("change", onChange));
  return systemTheme();
});

export function ThemeProvider({
  children,
  defaultTheme = "dark",
  storageKey = "store-electron-theme",
}: {
  children: React.ReactNode;
  defaultTheme?: ThemePreference;
  storageKey?: string;
}) {
  const [preference, setPreference] = React.useState<ThemePreference>(() =>
    readStoredPreference(storageKey, defaultTheme),
  );
  const resolvedSystem = useAtomValue(systemThemeAtom);
  const theme: ResolvedTheme = preference === "system" ? resolvedSystem : preference;

  React.useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    root.style.colorScheme = theme;
  }, [theme]);

  React.useEffect(() => {
    window.electronTheme?.setSource(preference);
  }, [preference]);

  const setTheme = React.useCallback(
    (next: ThemePreference) => {
      localStorage.setItem(storageKey, Schema.encodeSync(ThemePreferenceSchema)(next));
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
