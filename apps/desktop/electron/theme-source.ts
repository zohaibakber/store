import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { ThemeSource } from "../src/host/shell-rpcs";
import { PrivateFiles } from "./private-files";

const DEFAULT_THEME_SOURCE: ThemeSource = "dark";

const decodeThemeSource = Schema.decodeUnknownOption(ThemeSource);

const themeSourceFile = Effect.fn("ThemeSource.file")(function* (userDataDirectory: string) {
  const path = yield* Path.Path;
  return path.join(userDataDirectory, "theme-source");
});

export const readThemeSource = Effect.fn("ThemeSource.read")(
  function* (userDataDirectory: string) {
    const files = yield* PrivateFiles;
    const file = yield* themeSourceFile(userDataDirectory);
    const stored = yield* files.readText(file);
    return Option.getOrElse(Option.flatMap(stored, decodeThemeSource), () => DEFAULT_THEME_SOURCE);
  },
  Effect.orElseSucceed((): ThemeSource => DEFAULT_THEME_SOURCE),
);

export const saveThemeSource = Effect.fn("ThemeSource.save")(function* (
  userDataDirectory: string,
  source: ThemeSource,
) {
  const files = yield* PrivateFiles;
  yield* files.replaceText(yield* themeSourceFile(userDataDirectory), source);
});
