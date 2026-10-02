import { deviceLabelOf, type DeviceLabel } from "@store/contracts";

export const hostDeviceLabel = (hostname: string): DeviceLabel | undefined => {
  const [name = ""] = hostname.split(".");
  return name.includes("@") ? undefined : deviceLabelOf(name);
};
