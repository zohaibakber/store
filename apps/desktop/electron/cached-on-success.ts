import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

export const cachedOnSuccess = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.cachedWithTTL(self, (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero));
