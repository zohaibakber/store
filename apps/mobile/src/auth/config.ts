import * as Schema from "effect/Schema";

const Url = Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/u));

export const MobileAuthExtra = Schema.Struct({
  apiBaseUrl: Url,
  authBaseUrl: Url,
  googleWebClientId: Schema.optionalKey(Schema.String),
});
export interface MobileAuthExtra extends Schema.Schema.Type<typeof MobileAuthExtra> {}

export interface AuthConfig {
  readonly apiBaseUrl: string;
  readonly authBaseUrl: string;
  readonly googleWebClientId: string | null;
}

const withoutTrailingSlash = (value: string) => value.replace(/\/+$/u, "");

export const authConfigFrom = (extra: MobileAuthExtra): AuthConfig => {
  const googleWebClientId = extra.googleWebClientId?.trim() ?? "";
  return {
    apiBaseUrl: withoutTrailingSlash(extra.apiBaseUrl),
    authBaseUrl: withoutTrailingSlash(extra.authBaseUrl),
    googleWebClientId: googleWebClientId.length > 0 ? googleWebClientId : null,
  };
};
