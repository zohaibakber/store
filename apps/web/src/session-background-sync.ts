import type { AuthSessionBridge } from "@/lib/auth";

export const withSessionBackgroundSync = (input: {
  readonly bridge: AuthSessionBridge;
  readonly schedule: (work: () => void) => void;
  readonly startSync: () => Promise<void>;
}): AuthSessionBridge => {
  const scheduleSync = () => {
    input.schedule(() => void input.startSync().catch(() => undefined));
  };

  return {
    ...input.bridge,
    adoptSession: async (tokens) => {
      const snapshot = await input.bridge.adoptSession(tokens);
      scheduleSync();
      return snapshot;
    },
    renewSession: async () => {
      const snapshot = await input.bridge.renewSession();
      scheduleSync();
      return snapshot;
    },
  };
};
