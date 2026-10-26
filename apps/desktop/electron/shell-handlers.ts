import path from "node:path";

import { AuthClientError } from "@store/auth";
import { isWhatsAppUrl } from "@store/services/purchasing";
import { isUnreachable, RequestError } from "@store/workspace";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { WebContentsPrintOptions } from "electron";

import type { PrintOutcome, PrintPage } from "../src/host/share";
import {
  ExternalLinkRefused,
  ServerRequestFailed,
  ShellRpcs,
  SignInFailed,
  WorkspaceOpenFailed,
  WorkspaceRefused,
  MAX_CALLBACK_URL_LENGTH,
} from "../src/host/shell-rpcs";
import { makeSourceLinks } from "../src/host/source-links";
import { DesktopAuth } from "./auth";
import { cachedOnSuccess } from "./cached-on-success";
import { DesktopShell, ShellConnection } from "./desktop-shell";
import { loadDeviceId } from "./device-id";
import { PrivateFiles } from "./private-files";
import { ReplicaHost } from "./replica-host";
import type { ServerResponseInvalid } from "./server-api";
import { ShellEvents } from "./shell-events";
import { saveThemeSource } from "./theme-source";
import { Updater } from "./updater";

const SIGN_IN_FAILED = "Could not sign in.";
const GOOGLE_CALLBACK_INVALID = "The Google callback is invalid.";
const GOOGLE_URL_REFUSED = "Only Google authorization URLs can be opened.";
const PRINT_FAILED = "Printing failed. Check that a printer is connected.";
const PDF_FAILED = "The PDF could not be saved.";

const MICRONS_PER_MM = 1000;

const Messaged = Schema.Struct({ message: Schema.String });

const signInFailure = <A, E, R>(command: Effect.Effect<A, E, R>) =>
  Effect.catchCause(command, (cause) => {
    const failure = Cause.squash(cause);
    return Effect.fail(
      new SignInFailed({
        message: Schema.is(Messaged)(failure) ? failure.message : SIGN_IN_FAILED,
        unreachable: failure instanceof AuthClientError && failure.reason._tag === "Unreachable",
      }),
    );
  });

const serverFailure = Effect.mapError(
  (failure: RequestError | ServerResponseInvalid) =>
    new ServerRequestFailed({
      message: failure.message,
      unreachable: failure instanceof RequestError && isUnreachable(failure),
    }),
);

const googleAuthorizationUrl = (candidate: string) => {
  const url = URL.parse(candidate);
  return url?.protocol === "https:" && url.hostname === "accounts.google.com"
    ? Effect.succeed(url.href)
    : Effect.fail(new SignInFailed({ message: GOOGLE_URL_REFUSED, unreachable: false }));
};

const authorizationCodeOf = (candidate: string, redirectUri: string) => {
  const callback = candidate.length <= MAX_CALLBACK_URL_LENGTH ? URL.parse(candidate) : null;
  const expected = URL.parse(redirectUri);
  return expected !== null &&
    callback?.protocol === expected.protocol &&
    callback.host === expected.host &&
    callback.pathname === expected.pathname
    ? Effect.succeed(callback.searchParams.get("code"))
    : Effect.fail(new SignInFailed({ message: GOOGLE_CALLBACK_INVALID, unreachable: false }));
};

const printOptions = (page: PrintPage): WebContentsPrintOptions => {
  switch (page._tag) {
    case "A4":
      return { pageSize: "A4", printBackground: false };
    case "Roll":
      return {
        pageSize: {
          width: page.widthMm * MICRONS_PER_MM,
          height: page.heightMm * MICRONS_PER_MM,
        },
        margins: { marginType: "none" },
        printBackground: false,
      };
  }
};

const printOutcome = (success: boolean, failureReason: string): PrintOutcome => {
  if (success) return { _tag: "printed" };
  if (/cancel/iu.test(failureReason)) return { _tag: "cancelled" };
  return { _tag: "failed", message: PRINT_FAILED };
};

export const ShellHandlersLive = ShellRpcs.toLayer(
  Effect.gen(function* () {
    const auth = yield* DesktopAuth;
    const events = yield* ShellEvents;
    const shell = yield* DesktopShell;
    const replicas = yield* ReplicaHost;
    const updater = yield* Updater;
    const { sender } = yield* ShellConnection;
    const fileSystem = yield* FileSystem.FileSystem;
    const sourceLinks = makeSourceLinks();
    const platform = yield* Effect.context<Crypto.Crypto | Path.Path | PrivateFiles>();
    const deviceId = yield* cachedOnSuccess(
      loadDeviceId(shell.userDataPath).pipe(Effect.provideContext(platform), Effect.orDie),
    );

    return ShellRpcs.of({
      AuthSession: () => auth.session,
      AuthIdentify: (input) => signInFailure(auth.identify(input)),
      AuthAuthenticate: ({ credentials }) => signInFailure(auth.authenticate(credentials)),
      AuthBeginGoogle: () =>
        signInFailure(
          Effect.gen(function* () {
            const url = yield* googleAuthorizationUrl(
              yield* auth.beginGoogle(shell.oauthRedirectUri),
            );
            yield* shell.openExternal(url);
          }),
        ),
      AuthCompleteGoogle: ({ callbackUrl }) =>
        signInFailure(
          Effect.gen(function* () {
            const code = yield* authorizationCodeOf(callbackUrl, shell.oauthRedirectUri);
            return code === null ? null : yield* auth.completeGoogle(code);
          }),
        ),
      AuthRenew: () => serverFailure(auth.renewSession),
      AuthSignOut: () => auth.signOut,
      AuthOrganization: () => serverFailure(auth.organizationRoster),
      AuthOrganize: ({ command }) => serverFailure(auth.organize(command)),
      SessionChanges: () => Stream.fromPubSub(events.session),
      OAuthCallbacks: () => Stream.fromQueue(events.oauthCallbacks),
      SearchGlobalProducts: ({ query }) =>
        serverFailure(
          Effect.tap(auth.searchGlobalProducts(query), (result) =>
            Effect.sync(() => sourceLinks.remember(result)),
          ),
        ),
      InventoryHttpConfig: () =>
        Effect.map(deviceId, (id) => ({ apiBaseUrl: shell.apiBaseUrl, deviceId: id })),
      ReplicaOpen: ({ identity }) =>
        replicas
          .open(sender, identity)
          .pipe(
            Effect.mapError((failure) => new WorkspaceOpenFailed({ message: failure.message })),
          ),
      ReplicaClose: ({ workspaceToken }) =>
        replicas
          .close(sender.id, workspaceToken)
          .pipe(Effect.mapError((failure) => new WorkspaceRefused({ message: failure.message }))),
      ReplicaRetry: ({ workspaceToken }) =>
        replicas
          .retryRecovery(sender.id, workspaceToken)
          .pipe(Effect.mapError((failure) => new WorkspaceRefused({ message: failure.message }))),
      BackUp: () => replicas.backUp(sender.id),
      ChooseRestore: () => replicas.chooseRestore(sender.id),
      ApplyRestore: () => replicas.applyRestore(sender.id),
      DiscardRestore: () => replicas.discardRestore(sender.id),
      PublishOffer: ({ organizationId }) => replicas.offer(sender.id, organizationId),
      PublishStart: ({ organizationId }) => replicas.publish(sender.id, organizationId),
      PublishDiscard: ({ organizationId }) => replicas.discard(sender.id, organizationId),
      PublishLocalCatalog: () => replicas.localCatalog(sender.id),
      PublishProgress: () => Stream.fromPubSub(events.publishProgress),
      ShareOpenExternal: ({ url }) =>
        isWhatsAppUrl(url) || sourceLinks.allows(url)
          ? shell.openExternal(new URL(url).href).pipe(Effect.orDie)
          : Effect.fail(new ExternalLinkRefused()),
      ShareCopyText: ({ text }) => shell.writeClipboardText(text),
      ShareSavePdf: ({ fileStem }) =>
        Effect.gen(function* () {
          const chosen = yield* shell.dialogs.choosePdfDestination(`${fileStem}.pdf`);
          if (Option.isNone(chosen)) return { _tag: "cancelled" as const };
          const filePath = chosen.value;
          return yield* Effect.tryPromise(() =>
            sender.printToPDF({
              pageSize: "A4",
              preferCSSPageSize: true,
              printBackground: false,
            }),
          ).pipe(
            Effect.flatMap((data) => fileSystem.writeFile(filePath, data)),
            Effect.as({ _tag: "saved" as const, fileName: path.basename(filePath) }),
            Effect.catch(() => Effect.succeed({ _tag: "failed" as const, message: PDF_FAILED })),
          );
        }).pipe(
          Effect.catchTag("DialogFailed", () =>
            Effect.succeed({ _tag: "failed" as const, message: PDF_FAILED }),
          ),
        ),
      SharePrint: ({ page }) =>
        Effect.callback<PrintOutcome>((resume) => {
          sender.print(printOptions(page), (success, failureReason) =>
            resume(Effect.succeed(printOutcome(success, failureReason))),
          );
        }),
      ThemeSetSource: ({ source }) =>
        shell
          .setThemeSource(source)
          .pipe(
            Effect.andThen(
              saveThemeSource(shell.userDataPath, source).pipe(
                Effect.provideContext(platform),
                Effect.ignore,
              ),
            ),
          ),
      WindowMinimize: () => shell.minimizeWindow,
      WindowToggleMaximize: () => shell.toggleMaximizeWindow,
      WindowClose: () => shell.closeWindow,
      WindowMaximized: () => Stream.fromPubSub(events.maximized),
      NewSale: () => Stream.fromPubSub(events.newSale),
      UpdaterCheck: () => updater.checkNow,
      UpdaterInstall: () => updater.install,
      UpdaterEvents: () => Stream.fromPubSub(events.updater),
    });
  }),
);
