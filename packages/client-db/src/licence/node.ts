import { ShopId, type LicenceState } from "@store/contracts";
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

const SHOP_ROW_ID = "singleton";

const decodeShopRows = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ shopId: ShopId })));

export class ShopLicence extends Context.Service<
  ShopLicence,
  {
    readonly accept: (state: LicenceState) => Effect.Effect<void, ReplicaStorageError>;
    readonly shop: Effect.Effect<Option.Option<ShopId>>;
  }
>()("@store/client-db/ShopLicence") {}

export const layerShopLicence: Layer.Layer<ShopLicence, ReplicaStorageError, SqliteReplica> =
  Layer.effect(
    ShopLicence,
    Effect.gen(function* () {
      const replica = yield* SqliteReplica;
      const turn = yield* Semaphore.make(1);
      const oneAtATime = <A, E>(work: Effect.Effect<A, E>) => turn.withPermit(work);

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
        if (next._tag !== "missing" && Option.isNone(yield* Ref.get(shop))) {
          yield* claim(next.licence.shopId);
        }
      }, oneAtATime);

      return ShopLicence.of({ accept, shop: Ref.get(shop) });
    }),
  );
