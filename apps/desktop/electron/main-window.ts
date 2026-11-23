import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import type { BrowserWindow } from "electron";

/**
 * The one main window, while it is open. Shell commands (dialogs, window
 * controls) act on it through `use`, which does nothing once it has closed.
 */
export class MainWindow extends Context.Service<
  MainWindow,
  {
    readonly current: Effect.Effect<Option.Option<BrowserWindow>>;
    readonly set: (window: Option.Option<BrowserWindow>) => Effect.Effect<void>;
    readonly use: (control: (window: BrowserWindow) => void) => Effect.Effect<void>;
  }
>()("@store/desktop/MainWindow") {
  static readonly layer = Layer.effect(
    MainWindow,
    Effect.gen(function* () {
      const ref = yield* Ref.make(Option.none<BrowserWindow>());
      const current = Ref.get(ref).pipe(
        Effect.map(Option.filter((window) => !window.isDestroyed())),
      );
      return MainWindow.of({
        current,
        set: (window) => Ref.set(ref, window),
        use: (control) =>
          Effect.flatMap(current, (window) =>
            Option.isSome(window) ? Effect.sync(() => control(window.value)) : Effect.void,
          ),
      });
    }),
  );
}
