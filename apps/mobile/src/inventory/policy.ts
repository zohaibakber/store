import { inventoryReplicaScope } from "@store/client-db";
import * as Schema from "effect/Schema";

const REPLICA_FILE_PREFIX = "tabaaq-replica-v1";

const MobileExtra = Schema.Struct({
  apiBaseUrl: Schema.String.check(Schema.isMinLength(1)),
});

export const decodeMobileExtra = Schema.decodeUnknownOption(MobileExtra);

export const replicaDatabaseName = (
  apiBaseUrl: string,
  organizationId: string,
  userId: string,
): string =>
  `${REPLICA_FILE_PREFIX}-${encodeURIComponent(`${inventoryReplicaScope(apiBaseUrl, organizationId)}:${userId}`)}.sqlite`;

export type NetworkReachability = {
  readonly isConnected?: boolean;
  readonly isInternetReachable?: boolean;
};

export const isReachable = (state: NetworkReachability): boolean =>
  state.isInternetReachable ?? state.isConnected ?? false;

export const reconnected = (previous: boolean | undefined, next: boolean): boolean =>
  previous === false && next;

export type ReplicaVisibility = "foreground" | "background" | "unchanged";

export const visibilityForAppState = (state: string): ReplicaVisibility => {
  if (state === "active") return "foreground";
  if (state === "background") return "background";
  return "unchanged";
};
