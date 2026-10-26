import * as Context from "effect/Context";

export class AuthSettings extends Context.Service<
  AuthSettings,
  {
    readonly developmentOtp: boolean;
  }
>()("@store/auth-worker/AuthSettings") {}
