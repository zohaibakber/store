/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    APP_ROOT: string;
    VITE_PUBLIC: string;
  }
}

interface Window {
  offlineStore?: import("@store/contracts").OfflineStoreApi;
  electronTheme?: {
    setSource: (source: "dark" | "light" | "system") => void;
  };
  auth?: {
    getSession: () => Promise<import("@store/contracts").WorkspaceSnapshot>;
    adoptSession: (token: string | null) => Promise<import("@store/contracts").WorkspaceSnapshot>;
    signOut: () => Promise<void>;
    onSessionChange: (
      callback: (snapshot: import("@store/contracts").WorkspaceSnapshot) => void,
    ) => () => void;
  };
  serverApi?: {
    analyseInvoices: (input: {
      files: Array<{ name: string; type: string; bytes: ArrayBuffer }>;
    }) => Promise<import("@store/contracts").InvoiceExtraction>;
  };
  updater?: {
    check: () => Promise<void>;
    download: () => Promise<void>;
    install: () => void;
    onEvent: (
      callback: (event: import("@store/contracts/updater").UpdaterEvent) => void,
    ) => () => void;
  };
}
