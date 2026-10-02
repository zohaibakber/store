import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const DeviceWorkspace = Schema.Struct({
  active: Schema.Literals(["local", "organization"]),
  localCatalog: Schema.Literals(["empty", "stocked"]),
});

export interface DeviceWorkspace extends Schema.Schema.Type<typeof DeviceWorkspace> {}

export type DeviceWorkspaceChange =
  | {
      readonly _tag: "Session";
      readonly organization: boolean;
      readonly signedIn: boolean;
    }
  | { readonly _tag: "Selected"; readonly active: DeviceWorkspace["active"] }
  | { readonly _tag: "LocalCatalog"; readonly state: DeviceWorkspace["localCatalog"] };

const activating = (
  device: DeviceWorkspace | null,
  active: DeviceWorkspace["active"],
): DeviceWorkspace =>
  device?.active === active ? device : { localCatalog: device?.localCatalog ?? "empty", active };

const witnessing = (
  device: DeviceWorkspace | null,
  localCatalog: DeviceWorkspace["localCatalog"],
): DeviceWorkspace | null => {
  if (device === null) return localCatalog === "empty" ? null : { active: "local", localCatalog };
  return device.localCatalog === localCatalog ? device : { active: device.active, localCatalog };
};

export const deviceWorkspaceAfter = (
  device: DeviceWorkspace | null,
  change: DeviceWorkspaceChange,
): DeviceWorkspace | null => {
  switch (change._tag) {
    case "Session":
      if (change.organization) {
        return change.signedIn || device === null ? activating(device, "organization") : device;
      }
      return device?.localCatalog === "stocked" ? activating(device, "local") : device;
    case "Selected":
      return activating(device, change.active);
    case "LocalCatalog":
      return witnessing(device, change.state);
  }
};

export type DeviceWorkspaceStore = {
  readonly current: () => DeviceWorkspace | null;
  readonly write: (next: DeviceWorkspace) => void;
};

const STORAGE_KEY = "store.device-workspace";

const DeviceWorkspaceJson = Schema.fromJsonString(DeviceWorkspace);
const decodeStored = Schema.decodeUnknownOption(DeviceWorkspaceJson);
const encodeStored = Schema.encodeSync(DeviceWorkspaceJson);

export const deviceWorkspaceStore = (
  storage: Pick<Storage, "getItem" | "setItem"> | null,
): DeviceWorkspaceStore => {
  let latest =
    storage === null ? null : Option.getOrNull(decodeStored(storage.getItem(STORAGE_KEY)));
  return {
    current: () => latest,
    write: (next) => {
      latest = next;
      try {
        storage?.setItem(STORAGE_KEY, encodeStored(next));
      } catch {
        return;
      }
    },
  };
};
