import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export class DialogFailed extends Schema.TaggedError<DialogFailed>()("DialogFailed", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export type Dialogs = {
  readonly chooseBackupDestination: (
    suggestedName: string,
  ) => Effect.Effect<Option.Option<string>, DialogFailed>;
  readonly chooseBackupSource: Effect.Effect<Option.Option<string>, DialogFailed>;
  readonly choosePdfDestination: (
    suggestedName: string,
  ) => Effect.Effect<Option.Option<string>, DialogFailed>;
};
