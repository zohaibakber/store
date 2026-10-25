import * as Schema from "effect/Schema";

import { CatalogCounts } from "./workspace-backup";

export const LocalCatalogReport = Schema.Union([
  Schema.TaggedStruct("empty", {}),
  Schema.TaggedStruct("stocked", {}),
  Schema.TaggedStruct("unknown", {}),
]);
export type LocalCatalogReport = typeof LocalCatalogReport.Type;

export const PublishOffer = Schema.Union([
  Schema.TaggedStruct("none", {}),
  Schema.TaggedStruct("available", { counts: CatalogCounts, resuming: Schema.Boolean }),
  Schema.TaggedStruct("elsewhere", { counts: CatalogCounts, organizationId: Schema.String }),
]);
export type PublishOffer = typeof PublishOffer.Type;

export const PublishProgress = Schema.Struct({ sent: Schema.Natural, total: Schema.Natural });
export type PublishProgress = typeof PublishProgress.Type;

export const Published = Schema.TaggedStruct("published", { counts: CatalogCounts });
export type PublishOutcome =
  | typeof Published.Type
  | { readonly _tag: "failed"; readonly message: string };

export type WorkspacePublishBridge = {
  readonly offer: (organizationId: string) => Promise<PublishOffer>;
  readonly publish: (organizationId: string) => Promise<PublishOutcome>;
  readonly discard: (organizationId: string) => Promise<PublishOffer>;
  readonly localCatalog: () => Promise<LocalCatalogReport>;
  readonly onProgress: (listener: (progress: PublishProgress) => void) => () => void;
};
