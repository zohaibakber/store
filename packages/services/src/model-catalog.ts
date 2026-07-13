import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class ModelCatalogError extends Data.TaggedError("ModelCatalogError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class ModelCatalogService extends Context.Service<
  ModelCatalogService,
  { readonly list: Effect.Effect<unknown, ModelCatalogError> }
>()("@store/services/ModelCatalogService") {}

export interface ModelCatalogConfig {
  readonly endpoint: string;
}

export const modelCatalogLayer = (config: ModelCatalogConfig) =>
  Layer.succeed(ModelCatalogService, {
    list: Effect.tryPromise({
      try: async () => {
        const response = await fetch(config.endpoint);
        if (!response.ok) throw new Error(`Model catalog request failed (${response.status}).`);
        return response.json();
      },
      catch: (cause) =>
        new ModelCatalogError({ message: "Could not load the model catalog.", cause }),
    }),
  });
