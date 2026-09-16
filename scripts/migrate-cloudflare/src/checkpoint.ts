import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import { MigrationInterrupted } from "./errors.ts";
import type { CheckpointName } from "./model.ts";

export interface CheckpointApi {
  readonly pass: (name: CheckpointName) => Effect.Effect<void, MigrationInterrupted>;
}

export class MigrationCheckpoint extends Context.Service<MigrationCheckpoint, CheckpointApi>()(
  "@store/migrate/Checkpoint",
) {}

export interface CheckpointTestApi extends CheckpointApi {
  readonly failOnce: (name: CheckpointName) => Effect.Effect<void>;
}

export class MigrationCheckpointTest extends Context.Service<
  MigrationCheckpointTest,
  CheckpointTestApi
>()("@store/migrate/Checkpoint/Test") {}

export const liveCheckpointLayer = Layer.sync(MigrationCheckpoint, () =>
  MigrationCheckpoint.of({
    pass: (_name: CheckpointName) => Effect.void,
  }),
);

export const testCheckpointLayer = Layer.effectContext(
  Effect.gen(function* () {
    const next = yield* Ref.make<Option.Option<CheckpointName>>(Option.none());
    const service = MigrationCheckpointTest.of({
      pass: Effect.fn("Migrate.Checkpoint.pass")(function* (name: CheckpointName) {
        const scheduled = yield* Ref.get(next);
        if (Option.isSome(scheduled) && scheduled.value === name) {
          yield* Ref.set(next, Option.none());
          return yield* Effect.fail(
            new MigrationInterrupted({
              checkpoint: name,
              message: `Migration interrupted at ${name}.`,
            }),
          );
        }
      }),
      failOnce: Effect.fn("Migrate.Checkpoint.failOnce")(function* (name: CheckpointName) {
        yield* Ref.set(next, Option.some(name));
      }),
    });
    return Context.empty().pipe(
      Context.add(MigrationCheckpoint, service),
      Context.add(MigrationCheckpointTest, service),
    );
  }),
);
