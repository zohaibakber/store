import { LicenceRefusal, type Licence, type LicenceState } from "@store/contracts";
import {
  DesktopRpcs,
  type ReplicaStorageError,
  type ReplicaUnavailable,
  type WorkspaceState,
} from "@store/contracts/replica";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcServer from "effect/rpc/RpcServer";
import * as Stream from "effect/Stream";
import type { MessagePortMain } from "electron";

import { layerMessagePortMain } from "./message-port-main-runner";

export type DesktopLicence = {
  readonly states: Stream.Stream<LicenceState>;
  readonly enter: (
    text: string,
  ) => Effect.Effect<Licence, LicenceRefusal | ReplicaStorageError | ReplicaUnavailable>;
};

export const noDesktopLicence: DesktopLicence = {
  states: Stream.concat(Stream.succeed<LicenceState>({ _tag: "missing" }), Stream.never),
  enter: () => Effect.fail(new LicenceRefusal({ reason: "missing" })),
};

export const layerDesktopServer = (
  port: MessagePortMain,
  states: Stream.Stream<WorkspaceState>,
  licence: DesktopLicence,
) =>
  RpcServer.layer(DesktopRpcs).pipe(
    Layer.provide(
      DesktopRpcs.toLayer({
        WorkspaceState: () => states,
        LicenceState: () => licence.states,
        EnterLicence: ({ text }) => licence.enter(text),
      }),
    ),
    Layer.provide(RpcServer.layerProtocolWorkerRunner),
    Layer.provide(layerMessagePortMain(port)),
  );
