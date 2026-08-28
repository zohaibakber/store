import type { WorkspaceSnapshot } from "@store/contracts";
import { fetchOrganizationRoster, organizeOrganization } from "@store/workspace";

import type { AuthSessionBridge } from "@/lib/auth";

import { WebAuthBroker } from "./auth";
import { makeReplayChannel } from "./replay-channel";

const DEVICE_ID_KEY = "tabaaq-web-device-id";

export const loadDeviceId = (
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
  createId: () => string = () => crypto.randomUUID(),
) => {
  const created = createId();
  try {
    const stored = storage.getItem(DEVICE_ID_KEY)?.trim();
    if (stored) return stored;
    storage.setItem(DEVICE_ID_KEY, created);
  } catch {
    // Storage can be blocked by browser policy. A process-local identifier
    // preserves local-first writes for this session without blocking startup.
  }
  return created;
};

export interface WebSessionHost {
  readonly bridge: AuthSessionBridge;
  readonly initialize: () => Promise<WorkspaceSnapshot>;
}

/**
 * Browser authentication lifecycle. Inventory lifecycle belongs to the
 * route-scoped TanStack provider and is deliberately absent here.
 */
export const startWebSession = (apiBaseUrl: string, authBaseUrl: string): WebSessionHost => {
  const events = makeReplayChannel<WorkspaceSnapshot>();
  const auth = new WebAuthBroker(apiBaseUrl, authBaseUrl);
  const deviceId = loadDeviceId();
  const publish = (snapshot: WorkspaceSnapshot) => {
    events.publish(snapshot);
    return snapshot;
  };

  const bridge: AuthSessionBridge = {
    getSession: async () => auth.snapshot,
    adoptSession: async (tokens) => publish(await auth.adoptSession(tokens)),
    renewSession: async () => publish(await auth.renewSession()),
    signOut: async () => {
      await auth.signOut();
      publish(auth.snapshot);
    },
    organizationRoster: () =>
      fetchOrganizationRoster((pathname, init) => auth.authRequest(pathname, init)),
    organize: (command) =>
      organizeOrganization((pathname, init) => auth.authRequest(pathname, init), command),
    apiRequest: (pathname, init) => auth.apiRequest(pathname, init),
    apiFetch: (input, init) => auth.apiFetch(input, init),
    deviceId,
    onSessionChange: events.subscribe,
  };

  return {
    bridge,
    initialize: async () => publish(await auth.initialize()),
  };
};
