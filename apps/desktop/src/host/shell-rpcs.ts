import {
  IdentifyInput,
  LoginRoute,
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
  OtpLoginCommand,
  PasswordLoginCommand,
  RegisterPasswordCommand,
} from "@store/auth";
import { MAX_INVOICE_UPLOAD_FILES } from "@store/contracts";
import {
  GlobalProductSearchInput,
  GlobalProductSearchResult,
  InvoiceExtraction,
} from "@store/contracts/server-api.schema";
import type { UpdaterEvent } from "@store/contracts/updater";
import { WorkspaceSnapshot } from "@store/contracts/workspace";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { ReplicaFileRefused } from "./file-refusal";
import { PrintOutcome, PrintPage, SavePdfOutcome } from "./share";
import { BackupSaved, RestoreApplied, RestoreStaged } from "./workspace-backup";
import { LocalCatalogReport, PublishOffer, PublishProgress, Published } from "./workspace-publish";

export const MAX_CALLBACK_URL_LENGTH = 2048;
export const MAX_COPIED_TEXT_LENGTH = 200_000;

export class SignInFailed extends Schema.TaggedError<SignInFailed>()("SignInFailed", {
  message: Schema.String,
  unreachable: Schema.Boolean,
}) {}

export class ServerRequestFailed extends Schema.TaggedError<ServerRequestFailed>()(
  "ServerRequestFailed",
  { message: Schema.String, unreachable: Schema.Boolean },
) {}

export class ExternalLinkRefused extends Schema.TaggedError<ExternalLinkRefused>()(
  "ExternalLinkRefused",
  {},
) {}

export class WorkspaceOpenFailed extends Schema.TaggedError<WorkspaceOpenFailed>()(
  "WorkspaceOpenFailed",
  { message: Schema.String },
) {}

export const ReplicaIdentity = Schema.Struct({
  authority: Schema.Literals(["local", "remote"]),
  organizationId: Schema.String,
  userId: Schema.String,
  replicaId: Schema.String,
});
export type ReplicaIdentity = typeof ReplicaIdentity.Type;

export const ReplicaOpened = Schema.Struct({
  workspaceToken: Schema.String,
  engine: Schema.Literals(["sqlite", "unavailable"]),
});
export type ReplicaOpened = typeof ReplicaOpened.Type;

export const InventoryHttpConfig = Schema.Struct({
  apiBaseUrl: Schema.String,
  deviceId: Schema.String,
});
export type InventoryHttpConfig = typeof InventoryHttpConfig.Type;

export const SignInCredentials = Schema.toEncoded(
  Schema.Union([
    PasswordLoginCommand.mapFields(Struct.omit(["client"])),
    OtpLoginCommand.mapFields(Struct.omit(["client"])),
    RegisterPasswordCommand.mapFields(Struct.omit(["client"])),
  ]),
);
export type SignInCredentials = typeof SignInCredentials.Type;

export const ThemeSource = Schema.Literals(["dark", "light", "system"]);
export type ThemeSource = typeof ThemeSource.Type;

export const InvoiceUpload = Schema.Struct({
  files: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      type: Schema.String,
      bytes: Schema.instanceOf(Uint8Array, {
        toCodecJson: () => undefined,
      }),
    }),
  ).check(Schema.isMaxLength(MAX_INVOICE_UPLOAD_FILES)),
});

export const UpdaterEventSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("checking") }),
  Schema.Struct({ type: Schema.Literal("available"), version: Schema.String }),
  Schema.Struct({ type: Schema.Literal("not-available") }),
  Schema.Struct({ type: Schema.Literal("progress"), percent: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("downloaded"), version: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("error"),
    message: Schema.String,
    retrying: Schema.Boolean,
    failure: Schema.Literals(["network", "pending-release", "other"]),
  }),
]) satisfies Schema.Codec<UpdaterEvent>;

export const ShellRpcs = RpcGroup.make(
  Rpc.make("AuthSession", { success: WorkspaceSnapshot }),
  Rpc.make("AuthIdentify", {
    payload: IdentifyInput.fields,
    success: LoginRoute,
    error: SignInFailed,
  }),
  Rpc.make("AuthAuthenticate", {
    payload: { credentials: SignInCredentials },
    success: WorkspaceSnapshot,
    error: SignInFailed,
  }),
  Rpc.make("AuthBeginGoogle", { error: SignInFailed }),
  Rpc.make("AuthCompleteGoogle", {
    payload: { callbackUrl: Schema.String },
    success: Schema.NullOr(WorkspaceSnapshot),
    error: SignInFailed,
  }),
  Rpc.make("AuthRenew", { success: WorkspaceSnapshot, error: ServerRequestFailed }),
  Rpc.make("AuthSignOut"),
  Rpc.make("AuthOrganization", { success: OrganizationRoster, error: ServerRequestFailed }),
  Rpc.make("AuthOrganize", {
    payload: { command: OrganizationCommand },
    success: OrganizationCommandResult,
    error: ServerRequestFailed,
  }),
  Rpc.make("SessionChanges", { success: WorkspaceSnapshot, stream: true }),
  Rpc.make("OAuthCallbacks", { success: Schema.String, stream: true }),
  Rpc.make("AnalyseInvoices", {
    payload: InvoiceUpload.fields,
    success: InvoiceExtraction,
    error: ServerRequestFailed,
  }),
  Rpc.make("SearchGlobalProducts", {
    payload: GlobalProductSearchInput.fields,
    success: GlobalProductSearchResult,
    error: ServerRequestFailed,
  }),
  Rpc.make("InventoryHttpConfig", { success: InventoryHttpConfig }),
  Rpc.make("ReplicaOpen", {
    payload: { identity: ReplicaIdentity },
    success: ReplicaOpened,
    error: WorkspaceOpenFailed,
  }),
  Rpc.make("ReplicaClose", { payload: { workspaceToken: Schema.String } }),
  Rpc.make("ReplicaRetry", { payload: { workspaceToken: Schema.String } }),
  Rpc.make("BackUp", { success: BackupSaved, error: ReplicaFileRefused }),
  Rpc.make("ChooseRestore", { success: RestoreStaged, error: ReplicaFileRefused }),
  Rpc.make("ApplyRestore", { success: RestoreApplied, error: ReplicaFileRefused }),
  Rpc.make("DiscardRestore"),
  Rpc.make("PublishOffer", {
    payload: { organizationId: Schema.String },
    success: PublishOffer,
  }),
  Rpc.make("PublishStart", {
    payload: { organizationId: Schema.String },
    success: Published,
    error: ReplicaFileRefused,
  }),
  Rpc.make("PublishDiscard", {
    payload: { organizationId: Schema.String },
    success: PublishOffer,
  }),
  Rpc.make("PublishLocalCatalog", { success: LocalCatalogReport }),
  Rpc.make("PublishProgress", { success: PublishProgress, stream: true }),
  Rpc.make("ShareOpenExternal", {
    payload: { url: Schema.String },
    error: ExternalLinkRefused,
  }),
  Rpc.make("ShareCopyText", {
    payload: { text: Schema.String.check(Schema.isMaxLength(MAX_COPIED_TEXT_LENGTH)) },
  }),
  Rpc.make("ShareSavePdf", {
    payload: { fileStem: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/u)) },
    success: SavePdfOutcome,
  }),
  Rpc.make("SharePrint", { payload: { page: PrintPage }, success: PrintOutcome }),
  Rpc.make("ThemeSetSource", { payload: { source: ThemeSource } }),
  Rpc.make("WindowMinimize"),
  Rpc.make("WindowToggleMaximize"),
  Rpc.make("WindowClose"),
  Rpc.make("WindowMaximized", { success: Schema.Boolean, stream: true }),
  Rpc.make("NewSale", { success: Schema.Void, stream: true }),
  Rpc.make("UpdaterCheck"),
  Rpc.make("UpdaterInstall"),
  Rpc.make("UpdaterEvents", { success: UpdaterEventSchema, stream: true }),
);
