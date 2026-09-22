import * as Schema from "effect/Schema";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";

import { Authorization } from "./http-authorization";
import { AuthHttpErrors } from "./http-errors";
import { AuthJwks } from "./jwt";
import {
  AuthClientKind,
  BeginGoogleInput,
  EmailAddress,
  ExchangeGoogleIdTokenInput,
  ExchangeGoogleInput,
  GoogleAuthorization,
  IdentifyInput,
  LoginRoute,
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
  OtpChallengeId,
  OtpCode,
  Password,
  RefreshInput,
  SignOutInput,
  TokenSet,
} from "./model";

const Health = Schema.Struct({ ok: Schema.Literal(true) });

const PasswordSignIn = Schema.Struct({
  _tag: Schema.Literal("Password"),
  email: EmailAddress,
  password: Password,
  client: AuthClientKind,
});

const OtpSignIn = Schema.Struct({
  _tag: Schema.Literal("Otp"),
  challengeId: OtpChallengeId,
  code: OtpCode,
  client: AuthClientKind,
});

const RegisterPassword = Schema.Struct({
  _tag: Schema.Literal("RegisterPassword"),
  email: EmailAddress,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  password: Password,
  client: AuthClientKind,
});

export const SessionOk = Schema.Struct({ ok: Schema.Literal(true) });

export const authSystemGroup = HttpApiGroup.make("system")
  .add(HttpApiEndpoint.get("landing", "/", { success: Health }))
  .add(HttpApiEndpoint.get("health", "/health", { success: Health }))
  .add(HttpApiEndpoint.get("jwks", "/.well-known/jwks.json", { success: AuthJwks }));

export const authSessionGroup = HttpApiGroup.make("session")
  .add(
    HttpApiEndpoint.post("identify", "/v1/identify", {
      payload: IdentifyInput,
      success: LoginRoute,
      error: AuthHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("signInPassword", "/v1/sign-in/password", {
      payload: PasswordSignIn,
      success: TokenSet,
      error: AuthHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("signInOtp", "/v1/sign-in/otp", {
      payload: OtpSignIn,
      success: TokenSet,
      error: AuthHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("signUpPassword", "/v1/sign-up/password", {
      payload: RegisterPassword,
      success: TokenSet,
      error: AuthHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("googleStart", "/v1/oauth/google/start", {
      payload: BeginGoogleInput,
      success: GoogleAuthorization,
      error: AuthHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("googleExchange", "/v1/oauth/google/exchange", {
      payload: ExchangeGoogleInput,
      success: TokenSet,
      error: AuthHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("googleNative", "/v1/oauth/google/native", {
      payload: ExchangeGoogleIdTokenInput,
      success: TokenSet,
      error: AuthHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("refresh", "/v1/session/refresh", {
      payload: RefreshInput,
      success: TokenSet,
      error: AuthHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("logout", "/v1/session/logout", {
      payload: SignOutInput,
      success: SessionOk,
      error: AuthHttpErrors,
    }),
  );

export const authOrganizationGroup = HttpApiGroup.make("organization")
  .add(
    HttpApiEndpoint.get("roster", "/v1/organization", {
      success: OrganizationRoster,
      error: AuthHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("command", "/v1/organization", {
      payload: OrganizationCommand,
      success: OrganizationCommandResult,
      error: AuthHttpErrors,
    }),
  )
  .middleware(Authorization);

export const AuthHttpApi = HttpApi.make("AuthHttpApi").add(
  authSystemGroup,
  authSessionGroup,
  authOrganizationGroup,
);
