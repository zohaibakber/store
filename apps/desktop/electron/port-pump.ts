import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type { MessagePortMain } from "electron";

export const pumpPorts = (
  renderer: MessagePortMain,
  worker: MessagePort,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const toWorker = (event: Electron.MessageEvent) => worker.postMessage(event.data);
      const toRenderer = (event: MessageEvent) => renderer.postMessage(event.data);
      const closeWorker = () => worker.close();
      const closeRenderer = () => renderer.close();
      renderer.on("message", toWorker);
      worker.addEventListener("message", toRenderer);
      renderer.once("close", closeWorker);
      worker.addEventListener("close", closeRenderer, { once: true });
      renderer.start();
      worker.start();
      return () => {
        renderer.off("message", toWorker);
        worker.removeEventListener("message", toRenderer);
        renderer.off("close", closeWorker);
        worker.removeEventListener("close", closeRenderer);
        renderer.close();
        worker.close();
      };
    }),
    (close) => Effect.sync(close),
  ).pipe(Effect.asVoid);
