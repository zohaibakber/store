import { MoonIcon } from "lucide-react";
import * as React from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Theme = "dark" | "light";

type ThemeContextValue = {
  setTheme: (theme: Theme) => void;
  theme: Theme;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function useTheme() {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error("ThemeToggle must be used inside ThemeProvider.");
  return context;
}

export function ThemeProvider({
  children,
  defaultTheme = "dark",
  storageKey = "store-electron-theme",
}: {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}) {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    const savedTheme = localStorage.getItem(storageKey);
    return savedTheme === "light" || savedTheme === "dark" ? savedTheme : defaultTheme;
  });

  React.useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    root.style.colorScheme = theme;
  }, [theme]);

  const setTheme = React.useCallback(
    (nextTheme: Theme) => {
      localStorage.setItem(storageKey, nextTheme);
      setThemeState(nextTheme);
    },
    [storageKey],
  );

  const value = React.useMemo(() => ({ setTheme, theme }), [setTheme, theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function ThemeToggle() {
  const id = React.useId();
  const { setTheme, theme } = useTheme();

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-2 py-2">
      <Label htmlFor={id} className="min-w-0 gap-2 text-sidebar-foreground">
        <MoonIcon aria-hidden="true" />
        <span className="truncate">Dark mode</span>
      </Label>
      <Switch
        id={id}
        checked={theme === "dark"}
        onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
      />
    </div>
  );
}
