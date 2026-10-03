import * as Schema from "effect/Schema";

export const settingsSections = ["account", "organization", "receipts", "data", "general"] as const;

export const SettingsSection = Schema.Literals(settingsSections);
export type SettingsSection = typeof SettingsSection.Type;

export const defaultSettingsSection: SettingsSection = "account";

const decodeSettingsSection = Schema.decodeUnknownOption(SettingsSection);

export const settingsSectionTitle = (section: SettingsSection): string => {
  switch (section) {
    case "account":
      return "Account";
    case "organization":
      return "Organization";
    case "receipts":
      return "Receipts";
    case "data":
      return "Data";
    case "general":
      return "General";
  }
};

export const settingsBreadcrumb = (section: string | undefined): string => {
  const decoded = decodeSettingsSection(section);
  return decoded._tag === "Some" ? settingsSectionTitle(decoded.value) : "Settings";
};

export const availableSettingsSections = (device: {
  readonly signedIn: boolean;
  readonly keepsDataOnDevice: boolean;
}): ReadonlyArray<SettingsSection> =>
  settingsSections.filter((section) => {
    switch (section) {
      case "account":
      case "receipts":
      case "general":
        return true;
      case "organization":
        return device.signedIn;
      case "data":
        return device.keepsDataOnDevice;
    }
  });
