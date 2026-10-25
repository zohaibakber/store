import { describe, expect, it } from "vite-plus/test";

import { makeShellPort, type ShellPortContents } from "../../electron/shell-port";
import { SHELL_PORT_CHANNEL } from "../../src/host/shell-port-channels";

const allowed = ["https://app.tabaaq.local"];

type Navigation = { isMainFrame: boolean; isSameDocument: boolean };

const makeContents = (id: number, navigation: Array<(details: Navigation) => void>) => {
  const contents: ShellPortContents = {
    id,
    mainFrame: { frameToken: "main" },
    on: (_event, listener) => navigation.push(listener),
    once: () => undefined,
  };
  return contents;
};

const setup = () => {
  const served: Array<string> = [];
  const released: Array<number> = [];
  const posted: Array<{ channel: string; transfer: ReadonlyArray<string> }> = [];
  const navigation: Array<(details: Navigation) => void> = [];
  const contents = makeContents(1, navigation);
  const shellPort = makeShellPort({
    allowedOrigins: () => allowed,
    mainWindowContentsId: () => 1,
    channel: () => ({ port1: "serve-end", port2: "renderer-end" }),
    serve: (_sender, port) => {
      served.push(port);
    },
    release: (id) => {
      released.push(id);
    },
  });
  shellPort.attach(contents);
  const request = (url: string, frameToken = "main", sender = contents) => ({
    sender,
    senderFrame: {
      url,
      frameToken,
      postMessage: (
        channel: string,
        _message: { readonly type: string },
        transfer: Array<string>,
      ) => {
        posted.push({ channel, transfer });
      },
    },
  });
  return { shellPort, request, contents, served, released, posted, navigation };
};

describe("shell port delivery", () => {
  it("hands the port only to the trusted main frame of the app window, once per document", () => {
    const { shellPort, request, contents, served, posted, navigation, released } = setup();

    expect(shellPort.request({ sender: contents, senderFrame: null })).toBe(false);
    expect(shellPort.request(request("https://evil.example/"))).toBe(false);
    expect(shellPort.request(request("https://app.tabaaq.local/", "child"))).toBe(false);
    expect(
      shellPort.request(request("https://app.tabaaq.local/", "main", makeContents(2, []))),
    ).toBe(false);
    expect(served).toEqual([]);
    expect(posted).toEqual([]);

    expect(shellPort.request(request("https://app.tabaaq.local/#/sales"))).toBe(true);
    expect(posted).toEqual([{ channel: SHELL_PORT_CHANNEL, transfer: ["renderer-end"] }]);
    expect(served).toEqual(["serve-end"]);

    expect(shellPort.request(request("https://app.tabaaq.local/"))).toBe(false);
    for (const listener of navigation) listener({ isMainFrame: true, isSameDocument: true });
    expect(shellPort.request(request("https://app.tabaaq.local/"))).toBe(false);
    for (const listener of navigation) listener({ isMainFrame: false, isSameDocument: false });
    expect(shellPort.request(request("https://app.tabaaq.local/"))).toBe(false);

    for (const listener of navigation) listener({ isMainFrame: true, isSameDocument: false });
    expect(released).toEqual([1]);
    expect(shellPort.request(request("https://app.tabaaq.local/"))).toBe(true);
    expect(served).toEqual(["serve-end", "serve-end"]);
  });
});
