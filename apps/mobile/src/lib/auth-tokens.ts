import type { TokenSet as TokenSetType } from "@store/auth";

export const usableAccessToken = (
  current: TokenSetType | null,
  refreshed: TokenSetType | null,
  now: number,
) => {
  if (refreshed) return refreshed.accessToken;
  if (current && current.accessExpiresAt > now) return current.accessToken;
  return null;
};
