import type { LicenceState } from "@store/contracts";

import { formatCount } from "@/lib/format";

export const ENTER_LICENCE = "Enter licence";
export const OPEN_LICENCE_FILE = "Open licence file";
export const RENEW_LICENCE = "Renew";
export const ENTER_NEW_LICENCE = "Enter a new licence";

const days = (count: number) => formatCount(count, "day");

export const licenceNoticeCopy = (state: LicenceState): string | undefined => {
  switch (state._tag) {
    case "missing":
    case "valid":
      return undefined;
    case "expiring":
      return `The licence ends in ${days(state.daysLeft)}`;
    case "grace":
      return `The licence ended. Sales stop in ${days(state.daysLeft)}`;
    case "expired":
      return "The licence has ended. You can look things up and print receipts, but not record sales or changes";
  }
};

export const licenceStatusCopy = (state: LicenceState): string | undefined => {
  switch (state._tag) {
    case "missing":
    case "valid":
      return undefined;
    case "expiring":
      return `Licence ends in ${days(state.daysLeft)}`;
    case "grace":
      return `Licence ended. Sales stop in ${days(state.daysLeft)}`;
    case "expired":
      return "Licence ended";
  }
};
