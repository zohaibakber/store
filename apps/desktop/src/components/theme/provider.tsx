import { useAtom, useAtomValue } from "@effect/atom-react";
import { ComputerIcon, Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import * as Atom from "effect/reactivity/Atom";
import * as React from "react";

import { appHost } from "@/host";
import { themePreferenceAtom, type ThemePreference } from "@/lib/preferences";

type ResolvedTheme = "dark" | "light";

export const THEME_OPTIONS = [
  { value: "system", label: "System", icon: ComputerIcon },
  { value: "light", label: "Light", icon: Sun03Icon },
  { value: "dark", label: "Dark", icon: Moon02Icon },
] as const satisfies ReadonlyArray<{
  readonly value: ThemePreference;
  readonly label: string;
  readonly icon: unknown;
}>;

const systemThemeAtom = Atom.make((get): ResolvedTheme => {
  const query = window.matchMedia("(prefers-color-scheme: light)");
  const onChange = () => get.refreshSelf();
  query.addEventListener("change", onChange);
  get.addFinalizer(() => query.removeEventListener("change", onChange));
  return query.matches ? "light" : "dark";
});

const resolvedThemeAtom = Atom.make((get): ResolvedTheme => {
  const preference = get(themePreferenceAtom);
  return preference === "system" ? get(systemThemeAtom) : preference;
});

export function useTheme() {
  const [preference, setTheme] = useAtom(themePreferenceAtom);
  const theme = useAtomValue(resolvedThemeAtom);
  return { preference, setTheme, theme };
}

export function ThemeSync() {
  const { preference, theme } = useTheme();

  React.useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    root.style.colorScheme = theme;
  }, [theme]);

  React.useEffect(() => {
    appHost().theme.setSource(preference);
  }, [preference]);

  return null;
}
