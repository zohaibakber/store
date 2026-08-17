import Storage from "expo-sqlite/kv-store";
import { Appearance, useColorScheme } from "react-native";

const COLOR_SCHEME_KEY = "tabaaq.color-scheme";

export type AppColorScheme = "light" | "dark";

export const useAppColorScheme = (): AppColorScheme =>
  useColorScheme() === "dark" ? "dark" : "light";

export const followDeviceColorScheme = () => {
  Appearance.setColorScheme("unspecified");
  void Storage.removeItem(COLOR_SCHEME_KEY);
};
