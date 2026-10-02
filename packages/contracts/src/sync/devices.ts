import * as Schema from "effect/Schema";

import { EpochMillis, SyncIdentifier } from "../schema-primitives";

export const MAX_ORGANIZATION_DEVICES = 200;

export const OrganizationDevice = Schema.Struct({
  replicaId: SyncIdentifier,
  userId: Schema.String,
  label: Schema.NullOr(Schema.String),
  registeredAt: EpochMillis,
  lastSeenAt: EpochMillis,
  upToDate: Schema.Boolean,
  ignored: Schema.Boolean,
  holdsBack: Schema.Boolean,
});
export type OrganizationDevice = typeof OrganizationDevice.Type;

export const OrganizationDevices = Schema.Struct({
  devices: Schema.Array(OrganizationDevice),
});
export type OrganizationDevices = typeof OrganizationDevices.Type;

export const DeviceCommand = Schema.TaggedUnion({
  IgnoreDevice: { replicaId: SyncIdentifier },
  HeedDevice: { replicaId: SyncIdentifier },
  RemoveDevice: { replicaId: SyncIdentifier },
});
export type DeviceCommand = typeof DeviceCommand.Type;
