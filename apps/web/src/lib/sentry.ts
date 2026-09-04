import * as SentryEffect from "@sentry/effect/client";
import * as Sentry from "@sentry/react";
import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Tracer from "effect/Tracer";

const sentryDsn = () => import.meta.env.VITE_SENTRY_DSN?.trim() ?? "";

const SentryEffectLive = Layer.mergeAll(
  Layer.succeed(Tracer.Tracer, SentryEffect.SentryEffectTracer),
  Logger.layer([Logger.defaultLogger, SentryEffect.SentryEffectLogger]),
  SentryEffect.SentryEffectMetricsLayer,
);

const effectRuntime = ManagedRuntime.make(SentryEffectLive);

export const initClientSentry = () => {
  const dsn = sentryDsn();
  if (!dsn) return;
  Sentry.init({
    dsn,
    enableLogs: true,
    environment: import.meta.env.PROD ? "production" : "development",
    release: `tabaaq-web@${__APP_VERSION__}`,
    sendDefaultPii: false,
    tracesSampleRate: 1,
  });
};

export const runClientEffect = <A, E>(effect: Effect.Effect<A, E>) =>
  effectRuntime.runPromise(effect);

export { Sentry };
