import { writeFile } from "node:fs/promises";
import path from "node:path";

import { isWhatsAppUrl } from "@store/services/purchasing";
import type { SavePdfOutcome, ShareBridge } from "@store/web/host/share";
import * as Schema from "effect/Schema";
import type { IpcMain, IpcMainInvokeEvent } from "electron";

import { trustedIpcListener } from "./ipc-sender";
import {
  SHARE_COPY_TEXT_CHANNEL,
  SHARE_OPEN_EXTERNAL_CHANNEL,
  SHARE_SAVE_PDF_CHANNEL,
} from "./share-channels";

const MAX_COPIED_TEXT_LENGTH = 200_000;

const WhatsAppUrl = Schema.String.check(
  Schema.makeFilter(isWhatsAppUrl, { title: "WhatsApp link under https://wa.me/" }),
);

const CopiedText = Schema.String.check(Schema.isMaxLength(MAX_COPIED_TEXT_LENGTH));

const PdfFileStem = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/u));

const decodeWhatsAppUrl = Schema.decodeUnknownSync(WhatsAppUrl);
const decodeCopiedText = Schema.decodeUnknownSync(CopiedText);
const decodePdfFileStem = Schema.decodeUnknownSync(PdfFileStem);

type ShareIpcInput<Method extends keyof ShareBridge> = Parameters<ShareBridge[Method]>[0];

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

  const openExternal = async (
    _event: ShareIpcEvent,
    input: ShareIpcInput<"openExternal">,
  ): Promise<void> => {
    await options.openExternal(new URL(decodeWhatsAppUrl(input)).href);
  };

  const copyText = (_event: ShareIpcEvent, input: ShareIpcInput<"copyText">): void => {
    options.writeClipboardText(decodeCopiedText(input));
  };

  const savePdf = async (
    event: ShareIpcEvent,
    input: ShareIpcInput<"savePdf">,
  ): Promise<SavePdfOutcome> => {
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

  const trusted = <Input, Result>(listener: (event: ShareIpcEvent, input: Input) => Result) =>
    trustedIpcListener(options.allowedOrigins, listener);

  options.ipcMain.handle(SHARE_OPEN_EXTERNAL_CHANNEL, trusted(openExternal));
  options.ipcMain.handle(SHARE_COPY_TEXT_CHANNEL, trusted(copyText));
  options.ipcMain.handle(SHARE_SAVE_PDF_CHANNEL, trusted(savePdf));

  return () => {
    options.ipcMain.removeHandler(SHARE_OPEN_EXTERNAL_CHANNEL);
    options.ipcMain.removeHandler(SHARE_COPY_TEXT_CHANNEL);
    options.ipcMain.removeHandler(SHARE_SAVE_PDF_CHANNEL);
  };
};
