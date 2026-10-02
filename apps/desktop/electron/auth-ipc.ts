import {
  IdentifyInput,
  OrganizationCommand,
  OtpLoginCommand,
  PasswordLoginCommand,
  RegisterPasswordCommand,
} from "@store/auth";
import { MAX_INVOICE_UPLOAD_FILES } from "@store/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { flow } from "effect/Function";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import type { IpcMain } from "electron";

import { DesktopAuth, type AuthBroker } from "./auth";
import {
  AUTH_AUTHENTICATE_CHANNEL,
  AUTH_BEGIN_GOOGLE_CHANNEL,
  AUTH_COMPLETE_GOOGLE_CHANNEL,
  AUTH_GET_SESSION_CHANNEL,
  AUTH_IDENTIFY_CHANNEL,
  AUTH_ORGANIZATION_CHANNEL,
  AUTH_ORGANIZE_CHANNEL,
  AUTH_RENEW_SESSION_CHANNEL,
  AUTH_SIGN_OUT_CHANNEL,
} from "./auth-channels";
import { trustedIpcListener } from "./ipc-sender";
import { SERVER_UPLOADS_CHANNEL } from "./server-api-channels";

const SIGN_IN_FAILED = "Could not sign in.";
const EMAIL_INVALID = "Enter a valid email.";
const CREDENTIALS_INVALID = "The sign-in details are invalid.";
const GOOGLE_CALLBACK_INVALID = "The Google callback is invalid.";
const MAX_CALLBACK_URL_LENGTH = 2048;

const SignInCredentials = Schema.Union([
  PasswordLoginCommand.mapFields(Struct.omit(["client"])),
  OtpLoginCommand.mapFields(Struct.omit(["client"])),
  RegisterPasswordCommand.mapFields(Struct.omit(["client"])),
]);

const CallbackUrl = Schema.String.check(Schema.isMaxLength(MAX_CALLBACK_URL_LENGTH));

const InvoiceUpload = Schema.Struct({
  files: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      type: Schema.String,
      bytes: Schema.instanceOf(ArrayBuffer),
    }),
  ).check(Schema.isMaxLength(MAX_INVOICE_UPLOAD_FILES)),
});

class AuthIpcRejection extends Schema.TaggedError<AuthIpcRejection>()("AuthIpcRejection", {
  message: Schema.String,
}) {}

const decodeOrReject = <A>(schema: Schema.Codec<A, unknown>, message: string) =>
  flow(
    Schema.decodeUnknownEffect(schema),
    Effect.mapError(() => new AuthIpcRejection({ message })),
  );

const decodeIdentifyInput = decodeOrReject(IdentifyInput, EMAIL_INVALID);
const decodeSignInCredentials = decodeOrReject(SignInCredentials, CREDENTIALS_INVALID);
const decodeCallbackUrl = decodeOrReject(CallbackUrl, GOOGLE_CALLBACK_INVALID);
const decodeOrganizationCommand = Schema.decodeUnknownEffect(OrganizationCommand);
const decodeInvoiceUpload = Schema.decodeUnknownEffect(InvoiceUpload);

const googleAuthorizationUrl = (candidate: string) => {
  const url = URL.parse(candidate);
  return url?.protocol === "https:" && url.hostname === "accounts.google.com"
    ? Effect.succeed(url.href)
    : Effect.fail(
        new AuthIpcRejection({ message: "Only Google authorization URLs can be opened." }),
      );
};

const authorizationCodeOf = (candidate: string, redirectUri: string) => {
  const callback = URL.parse(candidate);
  const expected = URL.parse(redirectUri);
  return expected !== null &&
    callback?.protocol === expected.protocol &&
    callback.host === expected.host &&
    callback.pathname === expected.pathname
    ? Effect.succeed(callback.searchParams.get("code"))
    : Effect.fail(new AuthIpcRejection({ message: GOOGLE_CALLBACK_INVALID }));
};

const userFacing = <A, E, R>(command: Effect.Effect<A, E, R>) =>
  Effect.catchCause(command, (cause) => {
    const failure = Cause.squash(cause);
    return Effect.fail(new Error(failure instanceof Error ? failure.message : SIGN_IN_FAILED));
  });

export const registerAuthIpc = (options: {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly broker: Pick<AuthBroker, "run">;
  readonly allowedOrigins: () => ReadonlyArray<string>;
  readonly oauthRedirectUri: string;
  readonly openExternal: (url: string) => Promise<void>;
}) => {
  const { ipcMain, allowedOrigins } = options;
  const { run } = options.broker;

  ipcMain.handle(
    AUTH_GET_SESSION_CHANNEL,
    trustedIpcListener(allowedOrigins, () => run(DesktopAuth.use((auth) => auth.session))),
  );
  ipcMain.handle(
    AUTH_IDENTIFY_CHANNEL,
    trustedIpcListener(allowedOrigins, (_event, input) =>
      run(
        userFacing(
          Effect.gen(function* () {
            const auth = yield* DesktopAuth;
            return yield* auth.identify(yield* decodeIdentifyInput(input));
          }),
        ),
      ),
    ),
  );
  ipcMain.handle(
    AUTH_AUTHENTICATE_CHANNEL,
    trustedIpcListener(allowedOrigins, (_event, input) =>
      run(
        userFacing(
          Effect.gen(function* () {
            const auth = yield* DesktopAuth;
            return yield* auth.authenticate(yield* decodeSignInCredentials(input));
          }),
        ),
      ),
    ),
  );
  ipcMain.handle(
    AUTH_BEGIN_GOOGLE_CHANNEL,
    trustedIpcListener(allowedOrigins, () =>
      run(
        userFacing(
          Effect.gen(function* () {
            const auth = yield* DesktopAuth;
            const url = yield* googleAuthorizationUrl(
              yield* auth.beginGoogle(options.oauthRedirectUri),
            );
            yield* Effect.promise(() => options.openExternal(url));
          }),
        ),
      ),
    ),
  );
  ipcMain.handle(
    AUTH_COMPLETE_GOOGLE_CHANNEL,
    trustedIpcListener(allowedOrigins, (_event, input) =>
      run(
        userFacing(
          Effect.gen(function* () {
            const auth = yield* DesktopAuth;
            const code = yield* authorizationCodeOf(
              yield* decodeCallbackUrl(input),
              options.oauthRedirectUri,
            );
            return code === null ? null : yield* auth.completeGoogle(code);
          }),
        ),
      ),
    ),
  );
  ipcMain.handle(
    AUTH_RENEW_SESSION_CHANNEL,
    trustedIpcListener(allowedOrigins, () => run(DesktopAuth.use((auth) => auth.renewSession))),
  );
  ipcMain.handle(
    AUTH_SIGN_OUT_CHANNEL,
    trustedIpcListener(allowedOrigins, () => run(DesktopAuth.use((auth) => auth.signOut))),
  );
  ipcMain.handle(
    AUTH_ORGANIZATION_CHANNEL,
    trustedIpcListener(allowedOrigins, () =>
      run(DesktopAuth.use((auth) => auth.organizationRoster)),
    ),
  );
  ipcMain.handle(
    AUTH_ORGANIZE_CHANNEL,
    trustedIpcListener(allowedOrigins, (_event, input) =>
      run(
        Effect.gen(function* () {
          const auth = yield* DesktopAuth;
          return yield* auth.organize(yield* decodeOrganizationCommand(input));
        }),
      ),
    ),
  );
  ipcMain.handle(
    SERVER_UPLOADS_CHANNEL,
    trustedIpcListener(allowedOrigins, (_event, input) =>
      run(
        Effect.gen(function* () {
          const auth = yield* DesktopAuth;
          const upload = yield* decodeInvoiceUpload(input);
          return yield* auth.analyseInvoices(upload.files);
        }),
      ),
    ),
  );
};
