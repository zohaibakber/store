import type { LicenceRefusal } from "@store/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class LicenceGate extends Context.Service<
  LicenceGate,
  {
    readonly permit: Effect.Effect<void, LicenceRefusal>;
  }
>()("@store/client-db/LicenceGate") {
  static readonly layerOpen = Layer.succeed(LicenceGate, LicenceGate.of({ permit: Effect.void }));
}
