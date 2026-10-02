import { readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

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

export const saveThemeSource = async (userDataDirectory: string, source: ThemeSource) => {
  const file = themeSourceFile(userDataDirectory);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, source, { flag: "wx", mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
};
