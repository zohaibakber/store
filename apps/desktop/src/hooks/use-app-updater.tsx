import { useAtomMount, useAtomSet } from "@effect/atom-react";
import { classifyUpdateFailure, updateFailureMessage } from "@store/contracts";
import type { UpdaterEvent } from "@store/contracts/updater";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { toastManager } from "@/components/ui/toast";
import { appHost } from "@/host";
import type { AppUpdaterBridge } from "@/host";

const UPDATE_READY_TOAST_ID = "app-update-ready";
const UPDATE_CHECK_TOAST_ID = "app-update-check";

type CheckToast = Parameters<typeof toastManager.add>[0];

const updaterEvents = (updater: AppUpdaterBridge) =>
  Stream.callback<UpdaterEvent>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => updater.onEvent((event) => Queue.offerUnsafe(queue, event))),
      (stop) => Effect.sync(stop),
    ),
  );

const latestUpdaterEvent = Atom.make(
  Stream.unwrap(
    Effect.sync(() => {
      const updater = appHost().updater;
      return updater ? Stream.zipWithIndex(updaterEvents(updater)) : Stream.empty;
    }),
  ),
);

const eventOf = <E,>(result: AsyncResult.AsyncResult<readonly [UpdaterEvent, number], E>) =>
  Option.getOrUndefined(Option.map(AsyncResult.value(result), ([event]) => event));

const showUpdateReady = (version: string) => {
  const updater = appHost().updater;
  if (!updater) return;
  toastManager.close(UPDATE_CHECK_TOAST_ID);
  toastManager.add({
    actionProps: {
      children: "Restart",
      onClick: () => updater.install(),
    },
    data: { dismissLabel: "Later" },
    description: `Version ${version} installs when you restart Tabaaq.`,
    id: UPDATE_READY_TOAST_ID,
    timeout: 0,
    title: "Update ready",
    type: "success",
  });
};

const updateReadyFeed = Atom.make((get) => {
  get.subscribe(latestUpdaterEvent, (result) => {
    const event = eventOf(result);
    if (event?.type === "downloaded") showUpdateReady(event.version);
  });
});

const offlineToast = (): CheckToast => ({
  description: "Tabaaq will check for updates when you're back online.",
  id: UPDATE_CHECK_TOAST_ID,
  title: "You're offline",
  type: "info",
});

const settlesCheck = (event: UpdaterEvent): boolean => {
  switch (event.type) {
    case "available":
    case "downloaded":
    case "not-available":
    case "error":
      return true;
    case "checking":
    case "progress":
      return false;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
};

const checkToastFor = (event: UpdaterEvent): Option.Option<CheckToast> => {
  switch (event.type) {
    case "available":
      return Option.some({
        description: `Version ${event.version} is downloading in the background. You can keep working.`,
        id: UPDATE_CHECK_TOAST_ID,
        title: "Update available",
        type: "info",
      });
    case "not-available":
      return Option.some({
        description: `Version ${__APP_VERSION__} is the latest.`,
        id: UPDATE_CHECK_TOAST_ID,
        title: "You're up to date",
        type: "success",
      });
    case "error":
      return Option.some(
        event.failure === "network"
          ? offlineToast()
          : {
              description: event.message,
              id: UPDATE_CHECK_TOAST_ID,
              priority: event.retrying ? undefined : "high",
              title: event.retrying ? "Update check delayed" : "Update check failed",
              type: event.retrying ? "info" : "error",
            },
      );
    case "downloaded":
    case "checking":
    case "progress":
      return Option.none();
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
};

const Messaged = Schema.Struct({ message: Schema.String });

const rejectedCheckToast = (message: string): CheckToast => {
  const offline = classifyUpdateFailure(message) === "network";
  return {
    description: offline
      ? "Tabaaq will check for updates when you're back online."
      : updateFailureMessage(message),
    id: UPDATE_CHECK_TOAST_ID,
    priority: offline ? undefined : "high",
    title: offline ? "You're offline" : "Update check failed",
    type: offline ? "info" : "error",
  };
};

const checkForUpdate = Atom.fn<void>()(
  Effect.fn("AppUpdater.check")(function* (_, get) {
    const updater = appHost().updater;
    if (!updater) return;
    const settled = yield* Deferred.make<UpdaterEvent>();
    get.subscribe(latestUpdaterEvent, (result) => {
      const event = eventOf(result);
      if (event !== undefined && settlesCheck(event)) {
        Deferred.doneUnsafe(settled, Exit.succeed(event));
      }
    });
    toastManager.add({
      id: UPDATE_CHECK_TOAST_ID,
      timeout: 0,
      title: "Checking for updates…",
      type: "loading",
    });
    const rejected = Effect.tryPromise({
      try: () => updater.check(),
      catch: (error) => (Schema.is(Messaged)(error) ? error.message : ""),
    }).pipe(
      Effect.andThen(Effect.never),
      Effect.catch((message) => Effect.succeed(Option.some(rejectedCheckToast(message)))),
    );
    const toast = yield* Effect.raceFirst(
      Deferred.await(settled).pipe(Effect.map(checkToastFor)),
      rejected,
    );
    if (Option.isSome(toast)) toastManager.add(toast.value);
  }),
).pipe(Atom.keepAlive);

export const canCheckForAppUpdate = () => Boolean(appHost().updater);

export const useCheckForAppUpdate = () => {
  const check = useAtomSet(checkForUpdate);
  return () => check();
};

export function useAppUpdater() {
  useAtomMount(latestUpdaterEvent);
  useAtomMount(updateReadyFeed);
}
