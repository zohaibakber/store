import { CommandReceipt, SyncCommandEnvelope } from "@store/contracts";
import * as Schema from "effect/Schema";

import { inventoryRequest } from "../mutations";

export const submitOrganizationObjectCommand = (
  envelope: SyncCommandEnvelope,
  authenticatedFetch: typeof fetch,
  apiBaseUrl: string,
): Promise<CommandReceipt> =>
  inventoryRequest({
    apiBaseUrl,
    authenticatedFetch,
    path: "/sync/commands",
    body: Schema.encodeSync(SyncCommandEnvelope)(envelope),
    decode: Schema.decodeUnknownSync(CommandReceipt),
    failureLabel: "Sync command failed.",
  });
