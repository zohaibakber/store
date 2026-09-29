import { inventoryReplicaScope, sqliteReplicaFileName } from "@store/client-db";
import * as Schema from "effect/Schema";

const MobileExtra = Schema.Struct({
  apiBaseUrl: Schema.String.check(Schema.isMinLength(1)),
});

export const decodeMobileExtra = Schema.decodeUnknownOption(MobileExtra);

export const replicaDatabaseName = (
  apiBaseUrl: string,
  organizationId: string,
  userId: string,
): string =>
  sqliteReplicaFileName(
    encodeURIComponent(`${inventoryReplicaScope(apiBaseUrl, organizationId)}:${userId}`),
  );

export type NetworkReachability = {
  readonly type?: string;
  readonly isConnected?: boolean;
  readonly isInternetReachable?: boolean;
};

export const isReachable = (state: NetworkReachability): boolean =>
  state.isInternetReachable ?? state.isConnected ?? false;

const METERED_PULL_MAX_BYTES = 262_144;

const METERED_NETWORK_TYPES: ReadonlySet<string> = new Set(["CELLULAR", "BLUETOOTH"]);

export const pullMaxBytesFor = (state: NetworkReachability): number | undefined =>
  state.type !== undefined && METERED_NETWORK_TYPES.has(state.type)
    ? METERED_PULL_MAX_BYTES
    : undefined;

export const reconnected = (previous: boolean | undefined, next: boolean): boolean =>
  previous === false && next;

export type ReplicaVisibility = "foreground" | "background" | "unchanged";

export const visibilityForAppState = (state: string): ReplicaVisibility => {
  if (state === "active") return "foreground";
  if (state === "background") return "background";
  return "unchanged";
};
