import { SHELL_PORT_CHANNEL } from "../src/host/shell-port-channels";
import { isTrustedIpcSenderFrame, type TrustedIpcSenderFrame } from "./ipc-sender";

type NavigationDetails = { readonly isMainFrame: boolean; readonly isSameDocument: boolean };

export type ShellPortContents = {
  readonly id: number;
  readonly mainFrame: { readonly frameToken: string };
  readonly on: (
    event: "did-start-navigation",
    listener: (details: NavigationDetails) => void,
  ) => void;
  readonly once: {
    (event: "destroyed", listener: () => void): void;
    (event: "render-process-gone", listener: () => void): void;
  };
};

export type ShellPortFrame<Port> = TrustedIpcSenderFrame & {
  readonly frameToken: string;
  readonly postMessage: (
    channel: string,
    message: { readonly type: typeof SHELL_PORT_CHANNEL },
    transfer: Array<Port>,
  ) => void;
};

export type ShellPortRequest<Contents, Port> = {
  readonly senderFrame: ShellPortFrame<Port> | null;
  readonly sender: Contents;
};

export const makeShellPort = <Contents extends ShellPortContents, Port>(options: {
  readonly allowedOrigins: () => ReadonlyArray<string>;
  readonly mainWindowContentsId: () => number | undefined;
  readonly channel: () => { readonly port1: Port; readonly port2: Port };
  readonly serve: (sender: Contents, port: Port) => void;
  readonly release: (senderId: number) => void;
}) => {
  const documents = new Map<number, number>();
  const granted = new Map<number, number>();

  return {
    attach: (contents: Contents) => {
      const end = () => {
        documents.delete(contents.id);
        granted.delete(contents.id);
        options.release(contents.id);
      };
      contents.on("did-start-navigation", (details) => {
        if (!details.isMainFrame || details.isSameDocument) return;
        documents.set(contents.id, (documents.get(contents.id) ?? 0) + 1);
        options.release(contents.id);
      });
      contents.once("destroyed", end);
      contents.once("render-process-gone", end);
    },
    request: ({ senderFrame: frame, sender: contents }: ShellPortRequest<Contents, Port>) => {
      if (!frame || !isTrustedIpcSenderFrame(frame, options.allowedOrigins())) return false;
      if (frame.frameToken !== contents.mainFrame.frameToken) return false;
      if (contents.id !== options.mainWindowContentsId()) return false;
      const document = documents.get(contents.id) ?? 0;
      if (granted.get(contents.id) === document) return false;
      granted.set(contents.id, document);
      const channel = options.channel();
      options.serve(contents, channel.port1);
      frame.postMessage(SHELL_PORT_CHANNEL, { type: SHELL_PORT_CHANNEL }, [channel.port2]);
      return true;
    },
  };
};
