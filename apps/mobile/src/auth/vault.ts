import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SecureStore from "expo-secure-store";

import type { SessionVault } from "./controller";
import { LastOrganization, StoredSession } from "./model";

const SESSION_KEY = "tabaaq.session";
const LAST_ORGANIZATION_KEY = "tabaaq.last-organization";

const read = async <A>(key: string, schema: Schema.Codec<A, string>): Promise<A | null> => {
  const raw = await SecureStore.getItemAsync(key).catch(() => null);
  if (raw === null) return null;
  const decoded = Schema.decodeUnknownOption(schema)(raw);
  if (Option.isSome(decoded)) return decoded.value;
  await SecureStore.deleteItemAsync(key).catch(() => undefined);
  return null;
};

const StoredSessionJson = Schema.fromJsonString(StoredSession);
const LastOrganizationJson = Schema.fromJsonString(LastOrganization);

export const secureSessionVault: SessionVault = {
  load: () => read(SESSION_KEY, StoredSessionJson),
  save: (session) =>
    SecureStore.setItemAsync(SESSION_KEY, Schema.encodeSync(StoredSessionJson)(session)),
  clear: () => SecureStore.deleteItemAsync(SESSION_KEY),
  loadLastOrganization: () => read(LAST_ORGANIZATION_KEY, LastOrganizationJson),
  saveLastOrganization: (value) =>
    SecureStore.setItemAsync(LAST_ORGANIZATION_KEY, Schema.encodeSync(LastOrganizationJson)(value)),
};
