import "@sentry/electron/preload";
import { REPLICA_PORTS_CHANNEL, type ReplicaPortsMessage } from "@store/contracts/replica";
import { ipcRenderer, contextBridge } from "electron";

import type { ShellPortBridge } from "../src/host/electron";
import { SHELL_PORT_CHANNEL, SHELL_PORT_REQUEST_CHANNEL } from "../src/host/shell-port-channels";

ipcRenderer.on(REPLICA_PORTS_CHANNEL, (event, message: ReplicaPortsMessage) => {
  window.postMessage(message, "*", event.ports);
});

ipcRenderer.on(SHELL_PORT_CHANNEL, (event) => {
  window.postMessage({ type: SHELL_PORT_CHANNEL }, "*", event.ports);
});

const shellPort: ShellPortBridge = {
  connect: () => ipcRenderer.send(SHELL_PORT_REQUEST_CHANNEL),
};

contextBridge.exposeInMainWorld("shellPort", shellPort);
