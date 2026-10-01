import { writeFile } from "node:fs/promises";
import path from "node:path";

import { isWhatsAppUrl } from "@store/services/purchasing";
import * as Schema from "effect/Schema";
import type { IpcMain, IpcMainInvokeEvent } from "electron";

import type { SavePdfOutcome } from "../src/lib/share";
import { assertTrustedIpcSender } from "./ipc-sender";
import {
  SHARE_COPY_TEXT_CHANNEL,
  SHARE_OPEN_EXTERNAL_CHANNEL,
  SHARE_SAVE_PDF_CHANNEL,
  type ShareIpcBridge,
} from "./share-channels";

const MAX_COPIED_TEXT_LENGTH = 200_000;

export const WhatsAppUrl = Schema.String.check(
  Schema.makeFilter(isWhatsAppUrl, { title: "WhatsApp link under https://wa.me/" }),
);

export const CopiedText = Schema.String.check(Schema.isMaxLength(MAX_COPIED_TEXT_LENGTH));

export const PdfFileStem = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/u));

const decodeWhatsAppUrl = Schema.decodeUnknownSync(WhatsAppUrl);
const decodeCopiedText = Schema.decodeUnknownSync(CopiedText);
const decodePdfFileStem = Schema.decodeUnknownSync(PdfFileStem);

type ShareIpcInput<Method extends keyof ShareIpcBridge> = Parameters<ShareIpcBridge[Method]>[0];

type ShareIpcEvent = Pick<IpcMainInvokeEvent, "senderFrame"> & {
  readonly sender: Pick<IpcMainInvokeEvent["sender"], "printToPDF">;
};

export const registerShareIpc = (options: {
  readonly ipcMain: Pick<IpcMain, "handle" | "removeHandler">;
  readonly allowedOrigins: () => ReadonlyArray<string>;
  readonly openExternal: (url: string) => Promise<void>;
  readonly writeClipboardText: (text: string) => void;
  readonly choosePdfDestination: (suggestedName: string) => Promise<string | null>;
  readonly writePdf?: (filePath: string, data: Uint8Array) => Promise<void>;
}) => {
  const writePdf = options.writePdf ?? writeFile;
  const admit = (event: ShareIpcEvent) =>
    assertTrustedIpcSender(event.senderFrame, options.allowedOrigins());

  const openExternal = async (
    event: ShareIpcEvent,
    input: ShareIpcInput<"openExternal">,
  ): Promise<void> => {
    admit(event);
    await options.openExternal(new URL(decodeWhatsAppUrl(input)).href);
  };

  const copyText = (event: ShareIpcEvent, input: ShareIpcInput<"copyText">): void => {
    admit(event);
    options.writeClipboardText(decodeCopiedText(input));
  };

  const savePdf = async (
    event: ShareIpcEvent,
    input: ShareIpcInput<"savePdf">,
  ): Promise<SavePdfOutcome> => {
    admit(event);
    const fileStem = decodePdfFileStem(input);
    const filePath = await options.choosePdfDestination(`${fileStem}.pdf`);
    if (filePath === null) return { _tag: "cancelled" };
    try {
      const data = await event.sender.printToPDF({
        pageSize: "A4",
        preferCSSPageSize: true,
        printBackground: false,
      });
      await writePdf(filePath, data);
      return { _tag: "saved", fileName: path.basename(filePath) };
    } catch {
      return { _tag: "failed", message: "The PDF could not be saved." };
    }
  };

  options.ipcMain.handle(SHARE_OPEN_EXTERNAL_CHANNEL, openExternal);
  options.ipcMain.handle(SHARE_COPY_TEXT_CHANNEL, copyText);
  options.ipcMain.handle(SHARE_SAVE_PDF_CHANNEL, savePdf);

  return () => {
    options.ipcMain.removeHandler(SHARE_OPEN_EXTERNAL_CHANNEL);
    options.ipcMain.removeHandler(SHARE_COPY_TEXT_CHANNEL);
    options.ipcMain.removeHandler(SHARE_SAVE_PDF_CHANNEL);
  };
};
