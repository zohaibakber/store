import { LOCAL_ORGANIZATION_ID, LOCAL_USER_ID } from "@store/contracts";
import * as Result from "effect/Result";

import { ReplicaWorkerFailure, type ReplicaOpenInput } from "./replica-rpc";

export const LOCAL_REPLICA_KEY = `${LOCAL_ORGANIZATION_ID}-${LOCAL_USER_ID}`;

const PATH_SEPARATOR = /[\\/]/u;

const RESERVED_ORGANIZATION = LOCAL_ORGANIZATION_ID.toLowerCase();

const isReservedOrganization = (organizationId: string) =>
  organizationId.toLowerCase() === RESERVED_ORGANIZATION;

export const admitReplicaKey = (
  identity: typeof ReplicaOpenInput.Type,
): Result.Result<string, ReplicaWorkerFailure> => {
  switch (identity.authority) {
    case "local":
      return Result.succeed(LOCAL_REPLICA_KEY);
    case "remote": {
      const key = `${identity.organizationId}-${identity.userId}`;
      return isReservedOrganization(identity.organizationId) || PATH_SEPARATOR.test(key)
        ? Result.fail(
            new ReplicaWorkerFailure({
              message: "An organization workspace cannot open this catalog replica.",
            }),
          )
        : Result.succeed(key);
    }
  }
};
