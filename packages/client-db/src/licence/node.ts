import { LicenceRefusal, ShopId, type LicenceState } from "@store/contracts";
import type { ReplicaStorageError } from "@store/contracts/replica";
import { shopIdentity } from "@store/db/replica.schema";
import { SqliteReplica } from "@store/sync/sql-client";
import { eq } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { readFailure } from "../store/failures";
import { LicenceGate } from "../store/licence-gate";
import { licenceRefusalFor } from "./refusal";

const SHOP_ROW_ID = "singleton";

const decodeShopRows = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ shopId: ShopId })),
);

export class ShopLicence extends Context.Service<
  ShopLicence,
  {
    readonly accept: (state: LicenceState) => Effect.Effect<void, ReplicaStorageError>;
    readonly shop: Effect.Effect<Option.Option<ShopId>>;
  }
>()("@store/client-db/ShopLicence") {}

export const layerNodeLicenceGate: Layer.Layer<
  LicenceGate | ShopLicence,
  ReplicaStorageError,
  SqliteReplica
> = Layer.effectContext(
  Effect.gen(function* () {
    const replica = yield* SqliteReplica;
    const turn = yield* Semaphore.make(1);

    const readShop = replica.db
      .select({ shopId: shopIdentity.shopId })
      .from(shopIdentity)
      .where(eq(shopIdentity.id, SHOP_ROW_ID))
      .all()
      .pipe(
        Effect.flatMap(decodeShopRows),
        Effect.map((rows) => Option.fromNullishOr(rows[0]?.shopId)),
        Effect.mapError(readFailure),
      );

    const state = yield* Ref.make<LicenceState>({ _tag: "missing" });
    const shop = yield* Ref.make(yield* readShop);

    const claim = Effect.fnUntraced(function* (shopId: ShopId) {
      const claimedAt = yield* Clock.currentTimeMillis;
      yield* replica.db
        .insert(shopIdentity)
        .values({ id: SHOP_ROW_ID, shopId, claimedAt })
        .onConflictDoNothing()
        .pipe(Effect.mapError(readFailure));
      yield* Ref.set(shop, yield* readShop);
    });

    const accept = Effect.fn("ShopLicence.accept")(function* (next: LicenceState) {
      yield* Ref.set(state, next);
      if (next._tag !== "missing" && Option.isNone(yield* Ref.get(shop))) {
        yield* claim(next.licence.shopId);
      }
    }, turn.withPermit);

    const permit = Effect.gen(function* () {
      const refusal = licenceRefusalFor(yield* Ref.get(state), yield* Ref.get(shop));
      if (Option.isSome(refusal)) return yield* new LicenceRefusal({ reason: refusal.value });
    });

    return Context.make(LicenceGate, LicenceGate.of({ permit })).pipe(
      Context.add(ShopLicence, ShopLicence.of({ accept, shop: Ref.get(shop) })),
    );
  }),
);
