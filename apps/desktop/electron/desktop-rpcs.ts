import { DesktopRpcs, type WorkspaceState } from "@store/contracts/replica";
import * as Layer from "effect/Layer";
import * as RpcServer from "effect/rpc/RpcServer";
import type * as Stream from "effect/Stream";
import type { MessagePortMain } from "electron";

import { layerMessagePortMain } from "./message-port-main-runner";

export const layerDesktopServer = (port: MessagePortMain, states: Stream.Stream<WorkspaceState>) =>
  RpcServer.layer(DesktopRpcs).pipe(
    Layer.provide(DesktopRpcs.toLayer({ WorkspaceState: () => states })),
    Layer.provide(RpcServer.layerProtocolWorkerRunner),
    Layer.provide(layerMessagePortMain(port)),
  );
