import type { LegacyCatalogMigrationJobStatus } from "@store/contracts";

import { toastManager } from "@/components/ui/toast";

// v3 moves the handoff into a queue. Devices with a v2 marker replay through
// the idempotent worker so the server can verify the complete catalog.
const migratedKey = (scopeId: string) => `tabaaq-legacy-migrated:v3:${scopeId}`;

const migrated = new Set<string>();

/**
 * The legacy sqlite files stay on disk after a successful handoff, so without a
 * marker every launch would read and re-upload the whole catalog.
 */
export const legacyCatalogMigrated = (scopeId: string) => {
  if (migrated.has(scopeId)) return true;
  try {
    return globalThis.localStorage?.getItem(migratedKey(scopeId)) === "1";
  } catch {
    return false;
  }
};

export const markLegacyCatalogMigrated = (scopeId: string) => {
  migrated.add(scopeId);
  try {
    globalThis.localStorage?.setItem(migratedKey(scopeId), "1");
  } catch {
    // Private-mode refusals only cost a repeated upload on the next launch.
  }
};

export type LegacyCatalogMigrationToast =
  | {
      readonly kind: "queued";
      readonly description: string;
    }
  | {
      readonly kind: "migrating";
      readonly label: string;
      readonly progress: number;
    }
  | {
      readonly kind: "success";
      readonly description: string;
    }
  | {
      readonly kind: "error";
      readonly description: string;
    };

const phaseLabel = (phase: LegacyCatalogMigrationJobStatus["phase"]) => {
  switch (phase) {
    case "queued":
      return "Preparing inventory…";
    case "categories":
      return "Migrating categories…";
    case "products":
      return "Migrating products…";
    case "batches":
      return "Migrating stock batches…";
    case "invoices":
      return "Migrating invoices…";
    case "invoice-items":
      return "Migrating invoice lines…";
    case "stock-movements":
      return "Migrating stock history…";
    case "reconcile":
      return "Verifying migrated inventory…";
    case "complete":
      return "Migration complete";
  }
};

export const legacyCatalogMigrationToast = (
  status: LegacyCatalogMigrationJobStatus,
): LegacyCatalogMigrationToast => {
  switch (status.status) {
    case "queued":
      return {
        kind: "queued",
        description: "Your inventory migration is queued.",
      };
    case "migrating":
      return {
        kind: "migrating",
        label: phaseLabel(status.phase),
        progress: status.progress,
      };
    case "succeeded":
      return {
        kind: "success",
        description: `${status.importedRows} rows migrated to Neon.`,
      };
    case "failed":
      return {
        kind: "error",
        description: status.error,
      };
  }
};

const toastId = (scopeId: string) => `legacy-catalog-migration:${scopeId}`;

export const showLegacyCatalogMigrationToast = (
  scopeId: string,
  status: LegacyCatalogMigrationJobStatus,
) => {
  const toast = legacyCatalogMigrationToast(status);
  switch (toast.kind) {
    case "queued":
      toastManager.add({
        id: toastId(scopeId),
        title: "Migrating inventory…",
        description: toast.description,
        timeout: 0,
        type: "loading",
      });
      break;
    case "migrating":
      toastManager.add({
        id: toastId(scopeId),
        title: "Migrating inventory…",
        description: toast.label,
        data: { progress: { label: toast.label, value: toast.progress } },
        timeout: 0,
        type: "loading",
      });
      break;
    case "success":
      toastManager.add({
        id: toastId(scopeId),
        title: "Inventory migration complete",
        description: toast.description,
        type: "success",
      });
      break;
    case "error":
      toastManager.add({
        id: toastId(scopeId),
        title: "Inventory migration failed",
        description: toast.description,
        priority: "high",
        timeout: 0,
        type: "error",
      });
      break;
  }
};

export const showLegacyCatalogMigrationFailure = (scopeId: string, cause: unknown) => {
  toastManager.add({
    id: toastId(scopeId),
    title: "Inventory migration failed",
    description: cause instanceof Error ? cause.message : "Reopen the app to try again.",
    priority: "high",
    timeout: 0,
    type: "error",
  });
};
