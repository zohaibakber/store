import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import Constants from "expo-constants";

const Url = Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/u));

const MobileExtra = Schema.Struct({
  apiBaseUrl: Url,
  authBaseUrl: Url,
  googleWebClientId: Schema.optionalKey(Schema.String),
});

export interface MobileConfig {
  readonly apiBaseUrl: string;
  readonly authBaseUrl: string;
  readonly googleWebClientId: string | null;
}

const withoutTrailingSlash = (value: string) => value.replace(/\/+$/u, "");

const configFrom = (extra: typeof MobileExtra.Type): MobileConfig => {
  const googleWebClientId = extra.googleWebClientId?.trim() ?? "";
  return {
    apiBaseUrl: withoutTrailingSlash(extra.apiBaseUrl),
    authBaseUrl: withoutTrailingSlash(extra.authBaseUrl),
    googleWebClientId: googleWebClientId.length > 0 ? googleWebClientId : null,
  };
};

export const mobileConfig = Schema.decodeUnknownResult(MobileExtra)(
  Constants.expoConfig?.extra,
).pipe(Result.map(configFrom));
