import type { SyncStatus, WorkspaceSnapshot } from "@store/contracts";
import { localMigrations } from "@store/db/local/migrations";
import { browserLayer, OfflineStore } from "@store/persistence/browser";
import {
  AuthenticatedWorkspace,
  GuestWorkspaceRefused,
  fetchOrganizationRoster,
  makeOfflineStoreApi,
  organizeOrganization,
  withStoreEffect,
  type WorkspaceStoreAdapter,
  type WorkspaceTarget,
} from "@store/workspace";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";

import type { AuthSessionBridge } from "@/lib/auth";
import type { Store } from "@/lib/store";

import { WebAuthBroker } from "./auth";
import { openBrowserSyncSocket } from "./sync-socket";

const DEVICE_ID_KEY = "tabaaq-web-device-id";

const loadDeviceId = () => {
  const stored = localStorage.getItem(DEVICE_ID_KEY)?.trim();
  if (stored) return stored;
  const created = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
};

const dataDirectory = (target: WorkspaceTarget) =>
  target._tag === "Locked"
    ? "tabaaq-locked"
    : `tabaaq-${target.organizationId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

const withStore = withStoreEffect;

const makeWorkspaceStores = (input: {
  readonly baseUrl: string;
  readonly getAccessToken: () => string | null;
  readonly ensureFreshAccess: () => Promise<void>;
  readonly allowsGuestWorkspace: boolean;
}): WorkspaceStoreAdapter => ({
  open: async (target) => {
    if (target._tag === "Locked" && !input.allowsGuestWorkspace) {
      throw new GuestWorkspaceRefused({});
    }
    const baseConfig = {
      dataDir: dataDirectory(target),
      bundledMigrations: localMigrations,
      clientPlatform: "web" as const,
      clientVersion: __APP_VERSION__,
    };
    const persistenceConfig =
      target._tag === "Authenticated"
        ? {
            ...baseConfig,
            syncTransport: {
              openLive: openBrowserSyncSocket({
                baseUrl: input.baseUrl,
                organizationId: target.organizationId,
                deviceId: target.deviceId,
                getAccessToken: input.getAccessToken,
                ensureFreshAccess: input.ensureFreshAccess,
              }),
            },
            workspace: {
              organizationId: target.organizationId,
              userId: target.userId,
              deviceId: target.deviceId,
            },
          }
        : baseConfig;
    const runtime = ManagedRuntime.make(browserLayer(persistenceConfig));
    try {
      await runtime.runPromise(OfflineStore.pipe(Effect.asVoid));
    } catch (cause) {
      await runtime.dispose();
      throw cause;
    }
    return {
      run: (effect) => runtime.runPromise(effect),
      sync: () => runtime.runPromise(withStore((store) => store.sync)),
      onSyncStatusChange: (listener) =>
        runtime.runCallback(
          withStore((store) =>
            store.syncStatusChanges.pipe(
              Stream.runForEach((status) => Effect.sync(() => listener(status))),
            ),
          ),
        ),
      dispose: () => runtime.dispose(),
    };
  },
});

export interface WebWorkspace {
  readonly bridge: AuthSessionBridge;
  readonly store: Store;
  /**
   * Auth-only bootstrap. Unsigned sessions are published immediately (no Locked
   * store on the browser). Authenticated sessions are held until
   * {@link activateWorkspace}.
   */
  readonly resolveAuth: () => Promise<WorkspaceSnapshot>;
  /** Opens OfflineStore for a session returned by {@link resolveAuth}. */
  readonly activateWorkspace: () => Promise<WorkspaceSnapshot>;
  /** True once OfflineStore is open (e.g. after OAuth AdoptSession). */
  readonly hasStore: () => boolean;
}

export const startWebWorkspace = (
  baseUrl: string,
  authBaseUrl: string,
  options: { readonly allowsGuestWorkspace: boolean } = { allowsGuestWorkspace: false },
): WebWorkspace => {
  const snapshotListeners = new Set<(snapshot: WorkspaceSnapshot) => void>();
  const syncListeners = new Set<(status: SyncStatus) => void>();
  const auth = new WebAuthBroker(baseUrl, authBaseUrl);
  const workspace = new AuthenticatedWorkspace({
    auth,
    stores: makeWorkspaceStores({
      baseUrl,
      getAccessToken: () => auth.accessToken,
      ensureFreshAccess: async () => {
        await auth.ensureFreshAccess();
      },
      allowsGuestWorkspace: options.allowsGuestWorkspace,
    }),
    deviceId: loadDeviceId(),
    allowsGuestWorkspace: options.allowsGuestWorkspace,
    events: {
      publishSnapshot: (snapshot) => {
        for (const listener of snapshotListeners) listener(snapshot);
      },
      publishSyncStatus: (status) => {
        for (const listener of syncListeners) listener(status);
      },
    },
  });

  return {
    bridge: {
      getSession: async () => workspace.snapshot,
      adoptSession: (tokens) => workspace.execute({ _tag: "AdoptSession", tokens }),
      renewSession: () => workspace.execute({ _tag: "RenewSession" }),
      signOut: async () => {
        await workspace.execute({ _tag: "SignOut" });
      },
      organizationRoster: () =>
        fetchOrganizationRoster((pathname, init) => workspace.authRequest(pathname, init)),
      organize: (command) =>
        organizeOrganization((pathname, init) => workspace.authRequest(pathname, init), command),
      apiRequest: (pathname, init) => workspace.request(pathname, init),
      onSessionChange: (listener) => {
        snapshotListeners.add(listener);
        return () => snapshotListeners.delete(listener);
      },
    },
    store: makeOfflineStoreApi({
      run: (effect) => workspace.runStore(effect),
      onSyncStatusChange: (listener) => {
        syncListeners.add(listener);
        return () => syncListeners.delete(listener);
      },
    }),
    resolveAuth: () => workspace.resolveAuth(),
    activateWorkspace: async () => {
      const snapshot = await workspace.activateResolved();
      // React may subscribe onSessionChange after the first publish (useEffect).
      // Re-deliver so a Loading AuthProvider never stays stuck on #boot-shell→AppLoading.
      for (const listener of snapshotListeners) listener(workspace.snapshot);
      return snapshot;
    },
    hasStore: () => workspace.hasStore,
  };
};
