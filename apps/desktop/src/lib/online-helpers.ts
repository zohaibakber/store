export type OnlineHelpers = { readonly available: boolean };

const UNAVAILABLE: OnlineHelpers = { available: false };

export const useOnlineHelpers = (): OnlineHelpers => UNAVAILABLE;
