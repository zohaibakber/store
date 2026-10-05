import type {
  GlobalProductSearchResult,
  InvoiceExtraction,
} from "@store/contracts/server-api.schema";
import type { UpdaterEvent } from "@store/contracts/updater";

import type { InvoiceUploadFile } from "./invoice-upload";
import type { PrintOutcome, PrintPage, SavePdfOutcome } from "./share";
import type { WorkspaceBackupBridge } from "./workspace-backup";

export type AppUpdaterBridge = {
  readonly check: () => Promise<void>;
  readonly install: () => void;
  readonly onEvent: (listener: (event: UpdaterEvent) => void) => () => void;
};

export type ThemeSource = "dark" | "light" | "system";

export type ThemeBridge = { readonly setSource: (source: ThemeSource) => void };

export type WindowControlsBridge = {
  readonly minimize: () => void;
  readonly toggleMaximize: () => void;
  readonly close: () => void;
  readonly isMaximized: () => boolean;
  readonly onMaximizedChange: (listener: () => void) => () => void;
};

export type DesktopShellBridge = {
  readonly onNewSale: (listener: () => void) => () => void;
  readonly window: WindowControlsBridge;
};

export interface AppHost {
  readonly analyseInvoices: (files: ReadonlyArray<InvoiceUploadFile>) => Promise<InvoiceExtraction>;
  readonly searchGlobalProducts: (query: string) => Promise<GlobalProductSearchResult>;
  readonly shell: DesktopShellBridge;
  readonly updater?: AppUpdaterBridge;
  readonly theme: ThemeBridge;
  readonly backup: WorkspaceBackupBridge;
  readonly openExternal: (url: string) => Promise<void>;
  readonly copyText: (text: string) => Promise<void>;
  readonly savePdf: (fileStem: string) => Promise<SavePdfOutcome>;
  readonly print: (page: PrintPage) => Promise<PrintOutcome>;
}

let installed: AppHost | null = null;

export const installAppHost = (host: AppHost) => {
  installed = host;
};

export const appHost = (): AppHost => {
  if (!installed) throw new Error("The app host is not installed.");
  return installed;
};
