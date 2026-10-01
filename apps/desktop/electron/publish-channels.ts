import type { WorkspacePublishBridge } from "../src/lib/workspace-publish";

export const PUBLISH_OFFER_CHANNEL = "publish:offer";
export const PUBLISH_START_CHANNEL = "publish:start";
export const PUBLISH_DISCARD_CHANNEL = "publish:discard";
export const PUBLISH_LOCAL_CATALOG_CHANNEL = "publish:local-catalog";
export const PUBLISH_PROGRESS_CHANNEL = "publish:progress";

export type WorkspacePublishIpcBridge = WorkspacePublishBridge;
