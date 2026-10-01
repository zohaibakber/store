import { DatabaseExportIcon, DatabaseRestoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast";
import { appHost } from "@/host";
import type { Workspace } from "@/host-access";
import { useAuth } from "@/lib/auth";
import { catalogContents } from "@/lib/catalog-counts";
import { storeErrorMessage } from "@/lib/errors";
import type { RestoreChoice, WorkspaceBackupBridge } from "@/lib/workspace-backup";

type StagedRestore = Extract<RestoreChoice, { readonly _tag: "staged" }>;

type Activity = "idle" | "backingUp" | "choosing" | "restoring";

const KILOBYTE = 1024;

const fileSize = (bytes: number) =>
  bytes < KILOBYTE * KILOBYTE
    ? `${Math.max(1, Math.round(bytes / KILOBYTE))} KB`
    : `${(bytes / (KILOBYTE * KILOBYTE)).toFixed(1)} MB`;

type BackupOffer = {
  readonly backUp: string;
  readonly restore: string;
  readonly canBackUp: boolean;
  readonly canRestore: boolean;
};

const backupOffer = (workspace: Workspace): BackupOffer => {
  switch (workspace._tag) {
    case "Local":
      return {
        backUp:
          "Saves this device’s products, stock, sales and purchase orders to a file you choose. This is the only copy outside this device.",
        restore: "Replaces everything on this device with the contents of a backup file.",
        canBackUp: true,
        canRestore: true,
      };
    case "Organization":
      return {
        backUp: `Saves this device’s copy of ${workspace.organization.name}’s products, stock, sales and purchase orders to a file you choose.`,
        restore:
          "Only the workspace kept on this device can be restored from a file. An organization’s data comes back when you sign in.",
        canBackUp: true,
        canRestore: false,
      };
    case "None":
      return {
        backUp: "Open a workspace to back it up.",
        restore: "Open the workspace on this device to restore it.",
        canBackUp: false,
        canRestore: false,
      };
  }
};

const failure = (title: string, cause: unknown) =>
  toastManager.add({ title, description: storeErrorMessage(cause), type: "error" });

function BackupControls({ bridge }: { readonly bridge: WorkspaceBackupBridge }) {
  const offer = backupOffer(useAuth().workspace);
  const [activity, setActivity] = useState<Activity>("idle");
  const [staged, setStaged] = useState<StagedRestore | null>(null);
  const [confirming, setConfirming] = useState(false);
  const busy = activity !== "idle";

  const backUp = async () => {
    setActivity("backingUp");
    try {
      const outcome = await bridge.backUp();
      switch (outcome._tag) {
        case "saved":
          toastManager.add({
            title: "Backup saved",
            description: `${outcome.fileName}, ${fileSize(outcome.bytes)}`,
            type: "success",
          });
          break;
        case "failed":
          toastManager.add({
            title: "Backup not saved",
            description: outcome.message,
            type: "error",
          });
          break;
        case "cancelled":
          break;
      }
    } catch (cause) {
      failure("Backup not saved", cause);
    } finally {
      setActivity("idle");
    }
  };

  const chooseRestore = async () => {
    setActivity("choosing");
    try {
      const choice = await bridge.chooseRestore();
      switch (choice._tag) {
        case "staged":
          setStaged(choice);
          setConfirming(true);
          break;
        case "failed":
          toastManager.add({
            title: "This file cannot be restored",
            description: choice.message,
            type: "error",
          });
          break;
        case "cancelled":
          break;
      }
    } catch (cause) {
      failure("This file cannot be restored", cause);
    } finally {
      setActivity("idle");
    }
  };

  const dismissRestore = () => {
    setConfirming(false);
    void bridge.discardRestore().catch(() => undefined);
  };

  const applyRestore = async (fileName: string) => {
    setConfirming(false);
    setActivity("restoring");
    try {
      const outcome = await bridge.applyRestore();
      switch (outcome._tag) {
        case "restored":
          toastManager.add({
            title: "Workspace restored",
            description: `This device now holds the contents of ${fileName}.`,
            type: "success",
          });
          break;
        case "failed":
          toastManager.add({ title: "Not restored", description: outcome.message, type: "error" });
          break;
      }
    } catch (cause) {
      failure("Not restored", cause);
    } finally {
      setActivity("idle");
    }
  };

  return (
    <>
      <dl className="flex flex-col divide-y text-sm">
        <div className="flex items-center justify-between gap-4 pb-3">
          <div className="min-w-0">
            <dt>Back up to file</dt>
            <dd className="text-xs text-muted-foreground">{offer.backUp}</dd>
          </div>
          <Button
            className="shrink-0"
            disabled={!offer.canBackUp || busy}
            loading={activity === "backingUp"}
            onClick={() => void backUp()}
            size="sm"
            variant="outline"
          >
            <HugeiconsIcon aria-hidden="true" icon={DatabaseExportIcon} />
            Back up
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4 pt-3">
          <div className="min-w-0">
            <dt>Restore from file</dt>
            <dd className="text-xs text-muted-foreground">{offer.restore}</dd>
          </div>
          <Button
            className="shrink-0"
            disabled={!offer.canRestore || busy}
            loading={activity === "choosing" || activity === "restoring"}
            onClick={() => void chooseRestore()}
            size="sm"
            variant="outline"
          >
            <HugeiconsIcon aria-hidden="true" icon={DatabaseRestoreIcon} />
            Restore
          </Button>
        </div>
      </dl>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) dismissRestore();
        }}
        open={confirming}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace everything on this device?</AlertDialogTitle>
            <AlertDialogDescription>
              {staged
                ? `This device has ${catalogContents(staged.current)}. They will be replaced by the ${catalogContents(staged.backup)} in ${staged.fileName}. Anything added since that backup is lost.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
            <Button
              onClick={() => {
                if (staged) void applyRestore(staged.fileName);
              }}
              variant="destructive"
            >
              Replace
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function BackupSettings() {
  const [bridge] = useState(() => appHost().backup);
  return bridge ? <BackupControls bridge={bridge} /> : null;
}
