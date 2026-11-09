import type { StaffState } from "@store/contracts";
import * as Schema from "effect/Schema";

export const settingsSections = [
  "staff",
  "account",
  "organization",
  "receipts",
  "data",
  "general",
] as const;

export const SettingsSection = Schema.Literals(settingsSections);
export type SettingsSection = typeof SettingsSection.Type;

export const defaultSettingsSection: SettingsSection = "account";

const decodeSettingsSection = Schema.decodeUnknownOption(SettingsSection);

export const settingsSectionTitle = (section: SettingsSection): string => {
  switch (section) {
    case "staff":
      return "Staff";
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

export type StaffSectionPlace = "hidden" | "first" | "last";

export const staffSectionPlace = (staff: StaffState): StaffSectionPlace => {
  switch (staff._tag) {
    case "disabled":
    case "locked":
      return "hidden";
    case "solo":
      return "last";
    case "unlocked":
      return staff.actor.role === "owner" ? "first" : "hidden";
  }
};

export const availableSettingsSections = (
  signedIn: boolean,
  staff: StaffSectionPlace,
): ReadonlyArray<SettingsSection> => {
  const rest = settingsSections.filter(
    (section) => section !== "staff" && (section !== "organization" || signedIn),
  );
  switch (staff) {
    case "hidden":
      return rest;
    case "first":
      return ["staff", ...rest];
    case "last":
      return [...rest, "staff"];
  }
};
