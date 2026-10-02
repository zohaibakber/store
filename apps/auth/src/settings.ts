import * as Context from "effect/Context";
import type * as Redacted from "effect/Redacted";

export class AuthSettings extends Context.Service<
  AuthSettings,
  {
    readonly developmentOtp: boolean;
    readonly trustedRedirects: ReadonlyArray<string>;
    readonly refreshTokenPepper: Redacted.Redacted<string>;
  }
>()("@store/auth-worker/AuthSettings") {}
