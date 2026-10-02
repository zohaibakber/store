import type { ElectronReplicaBridge } from "@store/client-db";

export const AUTH_GET_SESSION_CHANNEL = "auth:get-session";
export const AUTH_IDENTIFY_CHANNEL = "auth:identify";
export const AUTH_AUTHENTICATE_CHANNEL = "auth:authenticate";
export const AUTH_BEGIN_GOOGLE_CHANNEL = "auth:begin-google";
export const AUTH_COMPLETE_GOOGLE_CHANNEL = "auth:complete-google";
export const AUTH_RENEW_SESSION_CHANNEL = "auth:renew-session";
export const AUTH_SIGN_OUT_CHANNEL = "auth:sign-out";
export const AUTH_ORGANIZATION_CHANNEL = "auth:organization";
export const AUTH_ORGANIZE_CHANNEL = "auth:organize";
export const AUTH_SESSION_CHANGED_CHANNEL = "auth:session-changed";
export const OAUTH_CALLBACK_CHANNEL = "auth:oauth-callback";

export const SERVER_UPLOADS_CHANNEL = "server:uploads";

export const INVENTORY_HTTP_CONFIG_CHANNEL = "inventory:http-config";

export const REPLICA_OPEN_CHANNEL = "replica:open";
export const REPLICA_CLOSE_CHANNEL = "replica:close";
export const REPLICA_STAMP_CHANNEL = "replica:stamp";
export const REPLICA_READ_SUBSET_CHANNEL = "replica:read-subset";
export const REPLICA_READ_BATCH_CHANNEL = "replica:read-batch";
export const REPLICA_CANCEL_READ_CHANNEL = "replica:cancel-read";
export const REPLICA_RETRY_CHANNEL = "replica:retry";
export const REPLICA_READ_INSIGHTS_CHANNEL = "replica:read-insights";
export const REPLICA_SUMMARIZE_SUBSET_CHANNEL = "replica:summarize-subset";
export const REPLICA_WAKE_CHANNEL = "replica:wake";
export const REPLICA_ACTIVITY_CHANNEL = "replica:activity";
export const REPLICA_COMMAND_STATUS_CHANNEL = "replica:command-status";
export const REPLICA_ENQUEUE_CHANNEL = "replica:enqueue";
export const REPLICA_INSIGHTS_SUMMARY_CHANNEL = "replica:insights-summary";
export const REPLICA_PRODUCT_INSIGHTS_CHANNEL = "replica:product-insights";
export const REPLICA_RESTOCK_PAGE_CHANNEL = "replica:restock-page";
export const REPLICA_ANALYTICS_CHANNEL = "replica:analytics";
export const REPLICA_COMMIT_CHANNEL = "replica:commit";
export const REPLICA_SYNC_HEALTH_CHANNEL = "replica:sync-health";

export const BACKUP_SAVE_CHANNEL = "backup:save";
export const RESTORE_CHOOSE_CHANNEL = "backup:choose-restore";
export const RESTORE_APPLY_CHANNEL = "backup:apply-restore";
export const RESTORE_DISCARD_CHANNEL = "backup:discard-restore";

export const PUBLISH_OFFER_CHANNEL = "publish:offer";
export const PUBLISH_START_CHANNEL = "publish:start";
export const PUBLISH_DISCARD_CHANNEL = "publish:discard";
export const PUBLISH_LOCAL_CATALOG_CHANNEL = "publish:local-catalog";
export const PUBLISH_PROGRESS_CHANNEL = "publish:progress";

export const SHARE_OPEN_EXTERNAL_CHANNEL = "share:open-external";
export const SHARE_COPY_TEXT_CHANNEL = "share:copy-text";
export const SHARE_SAVE_PDF_CHANNEL = "share:save-pdf";

export const THEME_SET_SOURCE_CHANNEL = "theme:set-source";

export const NEW_SALE_CHANNEL = "shell:new-sale";
export const WINDOW_MINIMIZE_CHANNEL = "shell:window-minimize";
export const WINDOW_TOGGLE_MAXIMIZE_CHANNEL = "shell:window-toggle-maximize";
export const WINDOW_CLOSE_CHANNEL = "shell:window-close";
export const WINDOW_MAXIMIZED_CHANNEL = "shell:window-maximized";

export const UPDATER_CHECK_CHANNEL = "updater:check";
export const UPDATER_DOWNLOAD_CHANNEL = "updater:download";
export const UPDATER_INSTALL_CHANNEL = "updater:install";
export const UPDATER_EVENT_CHANNEL = "updater:event";

export type ReplicaCommitEvent = Parameters<Parameters<ElectronReplicaBridge["onCommit"]>[0]>[0];

export type ReplicaAnalyticsEvent = Parameters<
  Parameters<ElectronReplicaBridge["onAnalytics"]>[0]
>[0];

export type ReplicaSyncHealthEvent = {
  readonly workspaceToken: string;
  readonly health: Parameters<Parameters<ElectronReplicaBridge["onSyncHealth"]>[1]>[0];
};
