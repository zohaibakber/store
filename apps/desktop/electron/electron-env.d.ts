/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string;
    /** /dist/ or /public/ */
    VITE_PUBLIC: string;
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  offlineStore: import("@store/contracts").OfflineStoreApi;
  auth: {
    getSession: () => Promise<import("./auth").AuthSnapshot>;
    signIn: (input: { email: string; password: string }) => Promise<import("./auth").AuthSnapshot>;
    signUp: (input: {
      name: string;
      email: string;
      password: string;
    }) => Promise<import("./auth").AuthSnapshot>;
    signOut: () => Promise<void>;
    switchOrganization: (input: {
      organizationId: string;
    }) => Promise<import("./auth").AuthSnapshot>;
    createOrganization: (input: { name: string }) => Promise<import("./auth").AuthSnapshot>;
    onSessionChange: (callback: (snapshot: import("./auth").AuthSnapshot) => void) => () => void;
  };
  serverApi: {
    getModels: () => Promise<unknown>;
    analyseInvoices: (input: {
      model: string;
      files: Array<{ name: string; type: string; bytes: ArrayBuffer }>;
    }) => Promise<unknown>;
  };
  updater: {
    getVersion: () => Promise<string>;
    check: () => Promise<void>;
    download: () => Promise<void>;
    install: () => void;
    onEvent: (callback: (event: import("./updater").UpdaterEvent) => void) => () => void;
  };
  windowControls: {
    minimize: () => void;
    toggleMaximize: () => Promise<boolean>;
    isMaximized: () => Promise<boolean>;
    isFullScreen: () => Promise<boolean>;
    onFullScreenChange: (callback: (isFullScreen: boolean) => void) => () => void;
    close: () => void;
  };
}
