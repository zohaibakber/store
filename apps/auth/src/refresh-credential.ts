import { RefreshToken, type AuthClientKind } from "@store/auth";
import * as Schema from "effect/Schema";

export type ResolvedRefresh = {
  readonly client: AuthClientKind;
  readonly refreshToken: typeof RefreshToken.Type;
};

export const resolveRefreshCredential = (input: {
  readonly cookie: string | undefined;
  readonly bodyToken: typeof RefreshToken.Type | undefined;
}): ResolvedRefresh | undefined => {
  if (input.bodyToken)
    return {
      client: { _tag: "Native", deviceName: "Native client" },
      refreshToken: input.bodyToken,
    };
  if (!input.cookie) return undefined;
  const decoded = Schema.decodeUnknownOption(RefreshToken)(input.cookie);
  if (decoded._tag !== "Some") return undefined;
  return { client: { _tag: "Browser" }, refreshToken: decoded.value };
};
