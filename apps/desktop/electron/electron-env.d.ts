declare global {
  const __APP_VERSION__: string;
  namespace NodeJS {
    interface ProcessEnv {
      APP_ROOT: string;
      VITE_SENTRY_DSN?: string;
    }
  }
}

export {};
