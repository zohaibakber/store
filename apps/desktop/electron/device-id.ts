import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const validDeviceId = (value: string) => value.length > 0 && value.length <= 200;

export const loadDeviceId = async (userDataDirectory: string) => {
  const file = path.join(userDataDirectory, "device-id");
  try {
    const stored = (await readFile(file, "utf8")).trim();
    if (validDeviceId(stored)) return stored;
  } catch {
    // Missing or unreadable persisted state is replaced below.
  }

  const created = crypto.randomUUID();
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, created, { flag: "wx", mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  return created;
};
