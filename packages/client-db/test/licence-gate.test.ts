import {
  LicenceId,
  LicenceRefusal,
  licenceStateOf,
  ShopId,
  ShopName,
  type Licence,
} from "@store/contracts";
import { InventoryStore } from "@store/contracts/replica";
import { SyncTransportService, type SyncTransport } from "@store/sync";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as RpcTest from "effect/rpc/RpcTest";
import type * as Scope from "effect/Scope";
import { describe, expect, it } from "vite-plus/test";

import { layerNodeLicenceGate, ShopLicence } from "../src/licence/node";
import { layerNodeReplicaSync } from "../src/replica/node-sync";
import { layerInventoryStore, StaffGate } from "../src/store/handlers";

const unreachable: SyncTransport = {
  registerReplica: () => Effect.never,
  submitCommand: () => Effect.never,
  getReceipt: () => Effect.never,
  pull: () => Effect.never,
  acquireSnapshot: () => Effect.never,
  readSnapshotPart: () => Effect.never,
};

const DAY = 86_400_000;
const NOW = Date.now();

const licenceFor = (shop: string, expiresAt: number): Licence => ({
  format: 1,
  id: LicenceId.make(`licence-${shop}-${expiresAt}`),
  shopId: ShopId.make(shop),
  shopName: ShopName.make("Test Pharmacy"),
  issuedAt: NOW - DAY,
  expiresAt,
  signingKeyId: "test",
  backup: null,
});

const run = <A, E>(test: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(test));

const reasonOf = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.flip(effect).pipe(
    Effect.map((failure) => (failure instanceof LicenceRefusal ? failure.reason : failure)),
  );

const openShop = (replicaId: string) =>
  Effect.gen(function* () {
    const session = yield* Layer.build(
      Layer.fresh(
        Layer.provideMerge(
          Layer.merge(StaffGate.layerDisabled, layerNodeLicenceGate),
          layerNodeReplicaSync({
            path: ":memory:",
            identity: { organizationId: "org-1", userId: "user-1", replicaId },
            databaseIdentity: `licence-gate-${replicaId}`,
            transport: Layer.succeed(SyncTransportService, unreachable),
            live: { apiBaseUrl: "https://api.example.com", accessToken: async () => null },
          }),
        ),
      ),
    );
    const store = yield* RpcTest.makeClient(InventoryStore, { flatten: true }).pipe(
      Effect.provide(
        Layer.fresh(layerInventoryStore.pipe(Layer.provide(Layer.succeedContext(session)))),
      ),
    );
    return {
      licence: Context.get(session, ShopLicence),
      createCategory: (name: string) => store("CreateCategory", { name }),
    };
  });

describe("licence gate", () => {
  it("refuses every command until main reports a licence that allows changes", () =>
    run(
      Effect.gen(function* () {
        const { licence, createCategory } = yield* openShop("a");
        expect(yield* reasonOf(createCategory("Tablets"))).toBe("missing");
        expect(yield* licence.shop).toEqual(Option.none());

        yield* licence.accept(licenceStateOf(licenceFor("shop-a", NOW + 100 * DAY), NOW));
        expect((yield* createCategory("Tablets")).result.name).toBe("Tablets");
        expect(yield* licence.shop).toEqual(Option.some("shop-a"));

        yield* licence.accept(licenceStateOf(licenceFor("shop-a", NOW - 5 * DAY), NOW));
        expect((yield* createCategory("Syrups")).result.name).toBe("Syrups");

        yield* licence.accept(licenceStateOf(licenceFor("shop-a", NOW - 15 * DAY), NOW));
        expect(yield* reasonOf(createCategory("Drops"))).toBe("expired");

        yield* licence.accept({
          _tag: "valid",
          licence: licenceFor("shop-a", NOW - 15 * DAY),
        });
        expect(yield* reasonOf(createCategory("Drops"))).toBe("expired");

        yield* licence.accept({ _tag: "missing" });
        expect(yield* reasonOf(createCategory("Drops"))).toBe("missing");
      }),
    ));

  it("refuses a valid licence for a shop the database does not belong to", () =>
    run(
      Effect.gen(function* () {
        const { licence, createCategory } = yield* openShop("b");
        yield* licence.accept(licenceStateOf(licenceFor("shop-a", NOW + 100 * DAY), NOW));
        yield* createCategory("Tablets");

        yield* licence.accept(licenceStateOf(licenceFor("shop-b", NOW + 100 * DAY), NOW));
        expect(yield* reasonOf(createCategory("Syrups"))).toBe("otherShop");
        expect(yield* licence.shop).toEqual(Option.some("shop-a"));

        yield* licence.accept(licenceStateOf(licenceFor("shop-a", NOW + 200 * DAY), NOW));
        expect((yield* createCategory("Syrups")).result.name).toBe("Syrups");
      }),
    ));
});
