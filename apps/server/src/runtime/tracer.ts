import * as Effect from "effect/Effect";

// `@effect/platform-cloudflare/CloudflareTracer` imports `cloudflare:workers`,
// which only resolves inside workerd. The stack imports the Worker and Durable
// Object modules in Node while planning, so the tracer loads on first use.
const loadWorkerTracer = Effect.promise(
  () => import("@effect/platform-cloudflare/CloudflareTracer"),
).pipe(Effect.map((CloudflareTracer) => CloudflareTracer.make()));

/**
 * Returns a function that records an effect's spans with the Workers `tracing`
 * API. Run it once in an isolate's init program: the tracer is built on the
 * first traced effect and shared after that.
 */
export const makeWorkerTracing = Effect.map(
  Effect.cached(loadWorkerTracer),
  (tracer) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.flatMap(tracer, (cloudflareTracer) => Effect.withTracer(effect, cloudflareTracer)),
);
