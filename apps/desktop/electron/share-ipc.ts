import { writeFile } from "node:fs/promises";
import path from "node:path";

import { isWhatsAppUrl } from "@store/services/purchasing";
import {
  PrintPage,
  type PrintOutcome,
  type SavePdfOutcome,
  type ShareBridge,
} from "@store/web/host/share";
import * as Schema from "effect/Schema";
import type { IpcMain, IpcMainInvokeEvent, WebContentsPrintOptions } from "electron";

import {
  SHARE_COPY_TEXT_CHANNEL,
  SHARE_OPEN_EXTERNAL_CHANNEL,
  SHARE_PRINT_CHANNEL,
  SHARE_SAVE_PDF_CHANNEL,
} from "./ipc-channels";
import { trustedIpcListener } from "./ipc-sender";

const MAX_COPIED_TEXT_LENGTH = 200_000;

const WhatsAppUrl = Schema.String.check(
  Schema.makeFilter(isWhatsAppUrl, { title: "WhatsApp link under https://wa.me/" }),
);

const CopiedText = Schema.String.check(Schema.isMaxLength(MAX_COPIED_TEXT_LENGTH));

const PdfFileStem = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/u));

const decodeWhatsAppUrl = Schema.decodeUnknownSync(WhatsAppUrl);
const decodeCopiedText = Schema.decodeUnknownSync(CopiedText);
const decodePdfFileStem = Schema.decodeUnknownSync(PdfFileStem);
const decodePrintPage = Schema.decodeUnknownSync(PrintPage);

const MICRONS_PER_MM = 1000;

const printOptions = (page: PrintPage): WebContentsPrintOptions => {
  switch (page._tag) {
    case "A4":
      return { pageSize: "A4", printBackground: false };
    case "Roll":
      return {
        pageSize: {
          width: page.widthMm * MICRONS_PER_MM,
          height: page.heightMm * MICRONS_PER_MM,
        },
        margins: { marginType: "none" },
        printBackground: false,
      };
  }
};

const printOutcome = (success: boolean, failureReason: string): PrintOutcome => {
  if (success) return { _tag: "printed" };
  if (/cancel/iu.test(failureReason)) return { _tag: "cancelled" };
  return { _tag: "failed", message: "Printing failed. Check that a printer is connected." };
};

type ShareIpcInput<Method extends keyof ShareBridge> = Parameters<ShareBridge[Method]>[0];

type ShareIpcEvent = Pick<IpcMainInvokeEvent, "senderFrame"> & {
  readonly sender: Pick<IpcMainInvokeEvent["sender"], "print" | "printToPDF">;
};

export const registerShareIpc = (options: {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly allowedOrigins: () => ReadonlyArray<string>;
  readonly openExternal: (url: string) => Promise<void>;
  readonly writeClipboardText: (text: string) => void;
  readonly choosePdfDestination: (suggestedName: string) => Promise<string | null>;
}) => {
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
      await writeFile(filePath, data);
      return { _tag: "saved", fileName: path.basename(filePath) };
    } catch {
      return { _tag: "failed", message: "The PDF could not be saved." };
    }
  };

  const print = (event: ShareIpcEvent, input: ShareIpcInput<"print">): Promise<PrintOutcome> => {
    const options = printOptions(decodePrintPage(input));
    return new Promise((resolve) => {
      event.sender.print(options, (success, failureReason) =>
        resolve(printOutcome(success, failureReason)),
      );
    });
  };

  const trusted = <Input, Result>(listener: (event: ShareIpcEvent, input: Input) => Result) =>
    trustedIpcListener(options.allowedOrigins, listener);

  options.ipcMain.handle(SHARE_OPEN_EXTERNAL_CHANNEL, trusted(openExternal));
  options.ipcMain.handle(SHARE_COPY_TEXT_CHANNEL, trusted(copyText));
  options.ipcMain.handle(SHARE_SAVE_PDF_CHANNEL, trusted(savePdf));
  options.ipcMain.handle(SHARE_PRINT_CHANNEL, trusted(print));
};
