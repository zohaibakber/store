import type { LicenceState } from "@store/contracts";

import { formatCount } from "@/lib/format";

export const LICENCE_HOW_TO_GET =
  "No licence yet? Ask the person who set up Tabaaq for you. A licence lasts one year.";

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
