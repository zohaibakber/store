import type { AuthClientKind, RefreshToken } from "@store/auth";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

export const UNIDENTIFIED_NATIVE_CLIENT: AuthClientKind = {
  _tag: "Native",
  deviceName: "Native client",
};

export interface PresentedRefresh {
  readonly client: AuthClientKind;
  readonly refreshToken: Redacted.Redacted<string>;
}

export const resolveRefreshCredential = (input: {
  readonly cookie: Option.Option<Redacted.Redacted<string>>;
  readonly bodyToken: RefreshToken | undefined;
}): PresentedRefresh | undefined => {
  if (input.bodyToken) {
    return { client: UNIDENTIFIED_NATIVE_CLIENT, refreshToken: Redacted.make(input.bodyToken) };
  }
  return Option.match(input.cookie, {
    onNone: () => undefined,
    onSome: (refreshToken): PresentedRefresh => ({ client: { _tag: "Browser" }, refreshToken }),
  });
};
