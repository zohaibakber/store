import { readFileSync } from "node:fs";
import path from "node:path";

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { replacePrivateFile } from "./private-file";

export const ThemeSource = Schema.Literals(["dark", "light", "system"]);
export type ThemeSource = typeof ThemeSource.Type;

const DEFAULT_THEME_SOURCE: ThemeSource = "dark";

const decodeThemeSource = Schema.decodeUnknownOption(ThemeSource);

const themeSourceFile = (userDataDirectory: string) => path.join(userDataDirectory, "theme-source");

export const readThemeSource = (userDataDirectory: string): ThemeSource => {
  try {
    return Option.getOrElse(
      decodeThemeSource(readFileSync(themeSourceFile(userDataDirectory), "utf8").trim()),
      () => DEFAULT_THEME_SOURCE,
    );
  } catch {
    return DEFAULT_THEME_SOURCE;
  }
};

export const saveThemeSource = (userDataDirectory: string, source: ThemeSource) =>
  replacePrivateFile(themeSourceFile(userDataDirectory), source);
