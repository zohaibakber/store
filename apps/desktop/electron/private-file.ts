import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const replacePrivateFile = async (file: string, contents: string | Uint8Array) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { flag: "wx", mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
};
