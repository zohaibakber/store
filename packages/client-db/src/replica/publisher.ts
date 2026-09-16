import type { ReplicaChangeFeed, ReplicaChangeUnsubscribe, ReplicaCommitNotice } from "./types";

export type ReplicaCommitPublisher = ReplicaChangeFeed & {
  readonly publish: (notice: ReplicaCommitNotice) => void;
  readonly dispose: () => void;
};

export const createReplicaCommitPublisher = (): ReplicaCommitPublisher => {
  const listeners = new Set<(notice: ReplicaCommitNotice) => void>();
  let open = true;

  return {
    subscribe: (listener: (notice: ReplicaCommitNotice) => void): ReplicaChangeUnsubscribe => {
      if (!open) return () => undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish: (notice: ReplicaCommitNotice): void => {
      if (!open) return;
      for (const listener of listeners) listener(notice);
    },
    dispose: (): void => {
      open = false;
      listeners.clear();
    },
  };
};
