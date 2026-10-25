import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { PrivateFiles } from "./private-files";

export const ThemeSource = Schema.Literals(["dark", "light", "system"]);
export type ThemeSource = typeof ThemeSource.Type;

const DEFAULT_THEME_SOURCE: ThemeSource = "dark";

const decodeThemeSource = Schema.decodeUnknownOption(ThemeSource);

const themeSourceFile = Effect.fn("ThemeSource.file")(function* (userDataDirectory: string) {
  const path = yield* Path.Path;
  return path.join(userDataDirectory, "theme-source");
});

export const readThemeSource = (userDataDirectory: string): Promise<ThemeSource> =>
  Effect.runPromise(
    themeSourceFile(userDataDirectory).pipe(
      Effect.flatMap((file) => PrivateFiles.use((files) => files.readText(file))),
      Effect.map((stored) =>
        Option.getOrElse(Option.flatMap(stored, decodeThemeSource), () => DEFAULT_THEME_SOURCE),
      ),
      Effect.orElseSucceed(() => DEFAULT_THEME_SOURCE),
      Effect.provide([PrivateFiles.layer, NodePath.layer]),
    ),
  );

export const saveThemeSource = (userDataDirectory: string, source: ThemeSource) =>
  Effect.runPromise(
    themeSourceFile(userDataDirectory).pipe(
      Effect.flatMap((file) => PrivateFiles.use((files) => files.replaceText(file, source))),
      Effect.provide([PrivateFiles.layer, NodePath.layer]),
    ),
  );
