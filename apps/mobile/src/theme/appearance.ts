import Storage from "expo-sqlite/kv-store";
import { Appearance, useColorScheme } from "react-native";

const COLOR_SCHEME_KEY = "tabaaq.color-scheme";

export type AppColorScheme = "light" | "dark";

export const useAppColorScheme = (): AppColorScheme =>
  useColorScheme() === "dark" ? "dark" : "light";

export const restoreAppColorScheme = async () => {
  const stored = await Storage.getItem(COLOR_SCHEME_KEY);
  if (stored === "light" || stored === "dark") Appearance.setColorScheme(stored);
};

export const setAppColorScheme = (scheme: AppColorScheme) => {
  Appearance.setColorScheme(scheme);
  void Storage.setItem(COLOR_SCHEME_KEY, scheme);
};
