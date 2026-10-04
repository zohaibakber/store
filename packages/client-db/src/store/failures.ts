import { ReplicaStorageError } from "@store/contracts/replica";
import { mapReplicaStoreFailure } from "@store/sync";

export const readFailure = (cause: unknown): ReplicaStorageError => {
  const failure = mapReplicaStoreFailure(cause);
  return failure._tag === "ReplicaStorageError"
    ? failure
    : new ReplicaStorageError({ message: failure.message });
};
