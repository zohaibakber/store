import { assert, it } from "@effect/vitest";
import type { UpdaterEvent } from "@store/contracts/updater";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { TestClock } from "effect/testing";

import {
  makeUpdaterWorkflow,
  type UpdaterProvider,
  type UpdaterProviderEvent,
  type UpdaterWorkflowConfig,
} from "../../electron/updater-workflow";

const config: UpdaterWorkflowConfig = {
  initialCheckDelay: 5_000,
  checkInterval: 15 * 60 * 1000,
  minimumCheckInterval: 5 * 60 * 1000,
  pendingReleaseRetryDelay: 30_000,
  periodicChecks: false,
};

const fixture = (overrides: Partial<UpdaterProvider> = {}) => {
  let listener: ((event: UpdaterProviderEvent) => void) | undefined;
  let checks = 0;
  let downloads = 0;
  let installs = 0;
  let unsubscribed = false;
  const events: UpdaterEvent[] = [];
  const provider: UpdaterProvider = {
    checkForUpdates: Effect.sync(() => {
      checks += 1;
    }),
    downloadUpdate: Effect.sync(() => {
      downloads += 1;
    }),
    quitAndInstall: () => {
      installs += 1;
    },
    subscribe: (next) => {
      listener = next;
      return () => {
        unsubscribed = true;
        listener = undefined;
      };
    },
    ...overrides,
  };
  return {
    provider,
    events,
    emit: (event: UpdaterProviderEvent) => listener?.(event),
    counts: () => ({ checks, downloads, installs }),
    isUnsubscribed: () => unsubscribed,
  };
};

it.effect("throttles manual checks and runs periodic checks on the configured cadence", () =>
  Effect.gen(function* () {
    const manual = fixture();
    const workflow = yield* makeUpdaterWorkflow(
      manual.provider,
      (event) => manual.events.push(event),
      config,
    );
    yield* workflow.check();
    yield* workflow.check();
    assert.strictEqual(manual.counts().checks, 1);

    yield* TestClock.adjust(config.minimumCheckInterval);
    yield* workflow.check();
    assert.strictEqual(manual.counts().checks, 2);
    yield* workflow.dispose;

    const periodic = fixture();
    const scheduled = yield* makeUpdaterWorkflow(
      periodic.provider,
      (event) => periodic.events.push(event),
      { ...config, periodicChecks: true },
    );
    assert.strictEqual(periodic.counts().checks, 0);
    yield* TestClock.adjust(config.initialCheckDelay);
    yield* Effect.promise(() => Promise.resolve());
    assert.strictEqual(periodic.counts().checks, 1);
    yield* TestClock.adjust(config.checkInterval);
    yield* Effect.promise(() => Promise.resolve());
    assert.strictEqual(periodic.counts().checks, 2);
    yield* scheduled.dispose;
  }),
);

it.effect("retries pending release metadata once and keeps network failures quiet", () =>
  Effect.gen(function* () {
    const test = fixture();
    const workflow = yield* makeUpdaterWorkflow(
      test.provider,
      (event) => test.events.push(event),
      config,
    );

    test.emit({
      type: "error",
      error: new Error("HttpError: 404 cannot find latest-linux.yml"),
    });
    test.emit({
      type: "error",
      error: new Error("HttpError: 404 cannot find latest-linux.yml"),
    });
    yield* Effect.yieldNow;
    assert.strictEqual(test.events.length, 2);

    yield* TestClock.adjust(config.pendingReleaseRetryDelay);
    assert.strictEqual(test.counts().checks, 1);

    test.emit({ type: "error", error: new Error("getaddrinfo ENOTFOUND github.com") });
    yield* Effect.yieldNow;
    assert.strictEqual(test.events.length, 2);
    yield* workflow.dispose;
  }),
);

it.effect("interrupts scheduled retries and racing provider events on disposal", () =>
  Effect.gen(function* () {
    const scheduled = fixture();
    const scheduledWorkflow = yield* makeUpdaterWorkflow(
      scheduled.provider,
      (event) => scheduled.events.push(event),
      config,
    );

    scheduled.emit({
      type: "error",
      error: new Error("HttpError: 404 cannot find latest-linux.yml"),
    });
    yield* Effect.yieldNow;
    assert.strictEqual(scheduled.events.length, 1);
    yield* scheduledWorkflow.dispose;
    yield* TestClock.adjust(config.pendingReleaseRetryDelay);
    assert.strictEqual(scheduled.counts().checks, 0);

    const racing = fixture();
    const racingWorkflow = yield* makeUpdaterWorkflow(
      racing.provider,
      (event) => racing.events.push(event),
      config,
    );
    racing.emit({
      type: "error",
      error: new Error("HttpError: 404 cannot find latest-linux.yml"),
    });
    yield* racingWorkflow.dispose;
    yield* TestClock.adjust(config.pendingReleaseRetryDelay);
    assert.strictEqual(racing.counts().checks, 0);
    assert.strictEqual(racing.isUnsubscribed(), true);
  }),
);

it.effect("serializes downloads and releases provider resources on disposal", () =>
  Effect.gen(function* () {
    let finishDownload: (() => void) | undefined;
    let downloadCalls = 0;
    const test = fixture({
      downloadUpdate: Effect.callback<void>((resume) => {
        downloadCalls += 1;
        finishDownload = () => resume(Effect.void);
      }),
    });
    const workflow = yield* makeUpdaterWorkflow(
      test.provider,
      (event) => test.events.push(event),
      config,
    );

    const first = yield* workflow.download.pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    yield* workflow.download;
    assert.strictEqual(downloadCalls, 1);
    finishDownload?.();
    yield* Fiber.join(first);

    test.emit({ type: "downloaded", version: "1.2.3" });
    yield* Effect.yieldNow;
    yield* workflow.install;
    assert.strictEqual(test.counts().installs, 1);

    yield* workflow.dispose;
    yield* workflow.dispose;
    assert.strictEqual(test.isUnsubscribed(), true);
  }),
);
