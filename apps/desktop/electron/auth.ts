import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  TokenSet,
  type IssuedSession,
  type OrganizationCommand,
  type OrganizationCommandResult,
  type OrganizationRoster,
} from "@store/auth";
import {
  unauthenticatedWorkspace,
  withWorkspaceOnline,
  WorkspaceSnapshot,
} from "@store/contracts/workspace";
import {
  MemoryTokenStore,
  SessionHttp,
  adoptAuthenticatedSnapshot,
  adoptSessionTokens,
  layerSessionHttp,
  loadSessionSnapshot,
  renewSessionSnapshot,
  sessionFetch,
  type SessionHttpApi,
  type SessionSnapshotHooks,
  type WorkspaceAuthAdapter,
} from "@store/workspace";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { app, net, safeStorage } from "electron";

import { analyseInvoiceUpload, type InvoiceUploadFile } from "../src/lib/invoice-upload";

const canPersistEncryptedSession = () =>
  safeStorage.isEncryptionAvailable() &&
  (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");

const PersistedAuth = Schema.Struct({ snapshot: WorkspaceSnapshot, tokens: TokenSet });
type PersistedAuth = typeof PersistedAuth.Type;

const unauthenticated = (isOnline: boolean, workspaceError: string | null = null) =>
  unauthenticatedWorkspace({ isOnline, workspaceError });

const netFetch: typeof fetch = (url, init) => net.fetch(url instanceof URL ? url.href : url, init);

const persistenceError = (cause: unknown) =>
  cause instanceof Error ? cause : new Error("Could not persist the authenticated session.");

export class AuthBroker implements WorkspaceAuthAdapter {
  readonly #tokens = new MemoryTokenStore();
  readonly #hooks: SessionSnapshotHooks;
  readonly #runtime: ManagedRuntime.ManagedRuntime<SessionHttp, never>;
  readonly apiFetch: typeof fetch;
  #snapshot: WorkspaceSnapshot = unauthenticated(false);

  constructor(
    baseUrl: string,
    authBaseUrl: string,
    publishSession: (snapshot: WorkspaceSnapshot) => void,
  ) {
    const forget = Effect.promise(() =>
      rm(this.#storagePath(), { force: true }).catch(() => undefined),
    );
    this.#hooks = {
      getLocalSnapshot: () => this.#snapshot,
      publish: (snapshot) => {
        this.#snapshot = snapshot;
        publishSession(snapshot);
        return snapshot;
      },
      clearAuthenticated: forget,
      persistAuthenticated: (snapshot) =>
        Effect.tryPromise({
          try: async () => {
            const tokens = this.#tokens.get();
            if (tokens) await this.#writePersisted({ snapshot, tokens });
          },
          catch: persistenceError,
        }),
    };
    this.#runtime = ManagedRuntime.make(
      layerSessionHttp({
        apiBaseUrl: baseUrl,
        authBaseUrl,
        tokens: this.#tokens,
        credential: "refreshToken",
        onRefreshed: (refreshed) =>
          adoptAuthenticatedSnapshot(this.#hooks, refreshed.workspace).pipe(Effect.asVoid),
        onRejected: Effect.sync(() => this.#hooks.publish(unauthenticated(true))).pipe(
          Effect.andThen(forget),
        ),
      }).pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, netFetch)),
      ),
    );
    this.apiFetch = sessionFetch((effect, options) => this.#runtime.runPromise(effect, options));
  }

  get snapshot() {
    return this.#snapshot;
  }

  #use<A, E>(f: (session: SessionHttpApi) => Effect.Effect<A, E, SessionHttp>) {
    return this.#runtime.runPromise(SessionHttp.use(f));
  }

  async liveAccessToken(force: boolean) {
    const access = await this.#use((session) => session.ensureFreshAccess(force));
    return access?.accessToken ?? null;
  }

  async initialize() {
    const persisted = await this.#readPersisted();
    if (!persisted) return this.#snapshot;
    this.#snapshot = withWorkspaceOnline(persisted.snapshot, false);
    const hooks = this.#hooks;
    return this.#use((session) =>
      Effect.gen(function* () {
        yield* session.setTokens(persisted.tokens);
        const access = yield* session.ensureFreshAccess().pipe(Effect.orElseSucceed(() => null));
        return access?.workspace === undefined
          ? yield* loadSessionSnapshot(hooks)
          : hooks.getLocalSnapshot();
      }),
    );
  }

  adoptSession(issued: IssuedSession | null) {
    return this.#runtime.runPromise(
      adoptSessionTokens(this.#hooks, issued, { onCleared: this.#hooks.clearAuthenticated }),
    );
  }

  renewSession() {
    return this.#runtime.runPromise(renewSessionSnapshot(this.#hooks));
  }

  signOut() {
    const hooks = this.#hooks;
    return this.#use((session) =>
      Effect.gen(function* () {
        yield* session.settled;
        const tokens = session.tokens.get();
        yield* session.setTokens(null);
        yield* session.logout(tokens).pipe(Effect.ignore);
        hooks.publish(unauthenticated(true));
        if (hooks.clearAuthenticated !== undefined) yield* hooks.clearAuthenticated;
      }),
    );
  }

  organizationRoster(): Promise<OrganizationRoster> {
    return this.#use((session) => session.organizationRoster);
  }

  organize(command: OrganizationCommand): Promise<OrganizationCommandResult> {
    return this.#use((session) => session.organize(command));
  }

  analyseInvoices(files: ReadonlyArray<InvoiceUploadFile>) {
    return this.#runtime.runPromise(analyseInvoiceUpload(files));
  }

  #storagePath() {
    return path.join(app.getPath("userData"), "auth", "session.bin");
  }

  async #readPersisted(): Promise<PersistedAuth | null> {
    try {
      const encrypted = await readFile(this.#storagePath());
      if (!canPersistEncryptedSession()) return null;
      return Schema.decodeUnknownOption(Schema.fromJsonString(PersistedAuth))(
        safeStorage.decryptString(encrypted),
      ).pipe(Option.getOrNull);
    } catch {
      return null;
    }
  }

  async #writePersisted(value: PersistedAuth) {
    if (!canPersistEncryptedSession()) {
      await rm(this.#storagePath(), { force: true });
      return;
    }
    await mkdir(path.dirname(this.#storagePath()), { recursive: true });
    await writeFile(
      this.#storagePath(),
      safeStorage.encryptString(Schema.encodeSync(Schema.fromJsonString(PersistedAuth))(value)),
      { mode: 0o600 },
    );
  }
}
