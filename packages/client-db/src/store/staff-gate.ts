import { StaffRefusal, type StaffId, type StaffPermission } from "@store/contracts";
import type { StaffRpcs } from "@store/contracts/replica";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as Stream from "effect/Stream";

type StaffRpc = RpcGroup.Rpcs<typeof StaffRpcs>;

export type StaffHandlers = {
  readonly [Current in StaffRpc as Current["_tag"]]: Rpc.ToHandlerFn<Current, never>;
};

const disabled = () => Effect.fail(new StaffRefusal({ reason: "disabled" }));

export class StaffGate extends Context.Service<
  StaffGate,
  {
    readonly handlers: StaffHandlers;
    readonly authorize: (
      permission: StaffPermission,
    ) => Effect.Effect<Option.Option<StaffId>, StaffRefusal>;
  }
>()("@store/client-db/StaffGate") {
  static readonly layerDisabled = Layer.succeed(
    StaffGate,
    StaffGate.of({
      handlers: {
        StaffState: () => Stream.concat(Stream.succeed({ _tag: "disabled" }), Stream.never),
        SetUpOwner: disabled,
        Unlock: disabled,
        Lock: () => Effect.void,
        AddStaff: disabled,
        UpdateStaff: disabled,
        RemoveStaff: disabled,
        RecoverOwner: disabled,
        RenewRecoveryCode: disabled,
        SetAutoLock: disabled,
        StaffEvents: disabled,
        HandOverDraft: disabled,
      },
      authorize: () => Effect.succeed(Option.none()),
    }),
  );
}
