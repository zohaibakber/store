import { readFile } from "node:fs/promises";
import path from "node:path";

import { replacePrivateFile } from "./private-file";

const validDeviceId = (value: string) => value.length > 0 && value.length <= 200;

export const loadDeviceId = async (userDataDirectory: string) => {
  const file = path.join(userDataDirectory, "device-id");
  try {
    const stored = (await readFile(file, "utf8")).trim();
    if (validDeviceId(stored)) return stored;
  } catch {}

  const created = crypto.randomUUID();
  await replacePrivateFile(file, created);
  return created;
};
