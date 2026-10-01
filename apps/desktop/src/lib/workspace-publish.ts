import * as Schema from "effect/Schema";

import { LocalCatalogReport } from "./local-catalog-standing";
import { CatalogCounts } from "./workspace-backup";

const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

export const PublishOffer = Schema.Union([
  Schema.TaggedStruct("none", {}),
  Schema.TaggedStruct("available", { counts: CatalogCounts, resuming: Schema.Boolean }),
  Schema.TaggedStruct("elsewhere", { counts: CatalogCounts, organizationId: Schema.String }),
]);
export type PublishOffer = typeof PublishOffer.Type;

export const PublishProgress = Schema.Struct({ sent: Count, total: Count });
export type PublishProgress = typeof PublishProgress.Type;

export const PublishOutcome = Schema.Union([
  Schema.TaggedStruct("published", { counts: CatalogCounts }),
  Schema.TaggedStruct("failed", { message: Schema.String }),
]);
export type PublishOutcome = typeof PublishOutcome.Type;

export type WorkspacePublishBridge = {
  readonly offer: (organizationId: string) => Promise<PublishOffer>;
  readonly publish: (organizationId: string) => Promise<PublishOutcome>;
  readonly discard: (organizationId: string) => Promise<PublishOffer>;
  readonly localCatalog: () => Promise<LocalCatalogReport>;
  readonly onProgress: (listener: (progress: PublishProgress) => void) => () => void;
};

const decodeOffer = Schema.decodeUnknownSync(PublishOffer);
const decodeOutcome = Schema.decodeUnknownSync(PublishOutcome);
const decodeProgress = Schema.decodeUnknownOption(PublishProgress);
const decodeLocalCatalog = Schema.decodeUnknownSync(LocalCatalogReport);

export const decodedPublishBridge = (bridge: WorkspacePublishBridge): WorkspacePublishBridge => ({
  offer: async (organizationId) => decodeOffer(await bridge.offer(organizationId)),
  publish: async (organizationId) => decodeOutcome(await bridge.publish(organizationId)),
  discard: async (organizationId) => decodeOffer(await bridge.discard(organizationId)),
  localCatalog: async () => decodeLocalCatalog(await bridge.localCatalog()),
  onProgress: (listener) =>
    bridge.onProgress((progress) => {
      const decoded = decodeProgress(progress);
      if (decoded._tag === "Some") listener(decoded.value);
    }),
});
