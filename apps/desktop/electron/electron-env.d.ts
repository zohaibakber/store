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
  ipcRenderer: import("electron").IpcRenderer;
  windowControls: {
    minimize: () => void;
    toggleMaximize: () => Promise<boolean>;
    isMaximized: () => Promise<boolean>;
    isFullScreen: () => Promise<boolean>;
    onFullScreenChange: (callback: (isFullScreen: boolean) => void) => () => void;
    close: () => void;
  };
}
