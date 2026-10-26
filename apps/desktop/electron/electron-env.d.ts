declare global {
  const __APP_VERSION__: string;
  const __API_URL__: string;
  const __AUTH_URL__: string;
  const __SENTRY_DSN__: string;
  namespace NodeJS {
    interface ProcessEnv {
      APP_ROOT: string;
    }
  }
}

export {};
