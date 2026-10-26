import type { UpdaterEvent } from "@store/contracts/updater";
import type { WorkspaceSnapshot } from "@store/contracts/workspace";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";

import type { PublishProgress } from "../src/host/workspace-publish";

export class ShellEvents extends Context.Service<
  ShellEvents,
  {
    readonly session: PubSub.PubSub<WorkspaceSnapshot>;
    readonly maximized: PubSub.PubSub<boolean>;
    readonly newSale: PubSub.PubSub<void>;
    readonly updater: PubSub.PubSub<UpdaterEvent>;
    readonly publishProgress: PubSub.PubSub<PublishProgress>;
    readonly oauthCallbacks: Queue.Queue<string>;
  }
>()("@store/desktop/ShellEvents") {
  static readonly layer = Layer.effect(
    ShellEvents,
    Effect.all({
      session: PubSub.unbounded<WorkspaceSnapshot>({ replay: 1 }),
      maximized: PubSub.unbounded<boolean>({ replay: 1 }),
      newSale: PubSub.unbounded<void>(),
      updater: PubSub.unbounded<UpdaterEvent>(),
      publishProgress: PubSub.unbounded<PublishProgress>(),
      oauthCallbacks: Queue.unbounded<string>(),
    }).pipe(Effect.map(ShellEvents.of)),
  );
}
