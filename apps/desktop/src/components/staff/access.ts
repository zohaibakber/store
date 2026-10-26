import {
  MAX_STAFF_NAME_LENGTH,
  MAX_STAFF_PIN_LENGTH,
  MIN_STAFF_PIN_LENGTH,
  permits,
  type StaffMember,
  type StaffPermission,
  type StaffRole,
  type StaffState,
} from "@store/contracts";
import { createContext, useContext } from "react";

const NO_STAFF: StaffState = { _tag: "disabled" };

export const StaffAccessContext = createContext<StaffState>(NO_STAFF);

export const useStaffAccess = (): StaffState => useContext(StaffAccessContext);

export const useStaffAllows = (permission: StaffPermission): boolean =>
  permits(useStaffAccess(), permission);

export const staffRoleLabel = (role: StaffRole): string => {
  switch (role) {
    case "owner":
      return "Owner";
    case "manager":
      return "Manager";
    case "cashier":
      return "Cashier";
  }
};

export type LandingPath = "/" | "/invoices/new";

export const landingPath = (role: StaffRole): LandingPath =>
  role === "cashier" ? "/invoices/new" : "/";

export const stateLandingPath = (state: StaffState): LandingPath =>
  state._tag === "unlocked" ? landingPath(state.actor.role) : "/";

const ROUTE_PERMISSIONS: ReadonlyArray<readonly [prefix: string, permission: StaffPermission]> = [
  ["/settings", "manageShop"],
  ["/products/new", "manageStock"],
  ["/products", "sell"],
  ["/invoices", "sell"],
  ["/categories", "manageStock"],
  ["/purchases", "manageStock"],
  ["/suppliers", "manageStock"],
  ["/restock", "manageStock"],
  ["/", "viewReports"],
];

const EDIT_SUFFIX = "/edit";

const isWithin = (pathname: string, prefix: string) =>
  prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`);

const withoutTrailingSlash = (pathname: string) =>
  pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

export const routePermission = (location: string): StaffPermission => {
  const pathname = withoutTrailingSlash(location);
  return pathname.endsWith(EDIT_SUFFIX)
    ? "manageStock"
    : (ROUTE_PERMISSIONS.find(([prefix]) => isWithin(pathname, prefix))?.[1] ?? "sell");
};

export const ownerFirst = (staff: ReadonlyArray<StaffMember>): ReadonlyArray<StaffMember> => [
  ...staff.filter((member) => member.role === "owner"),
  ...staff.filter((member) => member.role !== "owner"),
];

const PIN_PATTERN = new RegExp(`^\\d{${MIN_STAFF_PIN_LENGTH},${MAX_STAFF_PIN_LENGTH}}$`, "u");

export const PIN_HINT = `Use ${MIN_STAFF_PIN_LENGTH} to ${MAX_STAFF_PIN_LENGTH} digits.`;

export const pinDigits = (value: string): string =>
  value.replace(/\D/gu, "").slice(0, MAX_STAFF_PIN_LENGTH);

export const isPin = (value: string): boolean => PIN_PATTERN.test(value);

export const newPinProblem = (pin: string, again: string): string | null =>
  !isPin(pin) ? PIN_HINT : pin !== again ? "The two PINs do not match." : null;

export const nameProblem = (name: string): string | null => {
  const trimmed = name.trim();
  return trimmed === ""
    ? "Enter a name."
    : trimmed.length > MAX_STAFF_NAME_LENGTH
      ? `Use ${MAX_STAFF_NAME_LENGTH} characters or fewer.`
      : null;
};
