import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { StaffRefusal, type StaffId } from "@store/contracts";
import { InventoryStore } from "@store/contracts/replica";
import { SyncTransportService, type SyncTransport } from "@store/sync";
import { SqliteReplica } from "@store/sync/sql-client";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as RpcTest from "effect/rpc/RpcTest";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import { layerNodeReplicaSync } from "../src/replica/node-sync";
import { layerNodeStaffGate } from "../src/staff/node";
import { layerInventoryStore } from "../src/store/handlers";

const unreachable: SyncTransport = {
  registerReplica: () => Effect.never,
  submitCommand: () => Effect.never,
  getReceipt: () => Effect.never,
  pull: () => Effect.never,
  acquireSnapshot: () => Effect.never,
  readSnapshotPart: () => Effect.never,
};

const pin = (digits: string) => Redacted.make(digits);

const NOW = Date.UTC(2026, 9, 5);

const run = <A, E>(test: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(
    TestClock.setTime(NOW).pipe(
      Effect.andThen(test),
      Effect.scoped,
      Effect.provide(TestClock.layer()),
    ),
  );

const reasonOf = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.flip(effect).pipe(
    Effect.map((failure) => (failure instanceof StaffRefusal ? failure.reason : failure)),
  );

const openShop = (replicaId: string) =>
  Effect.gen(function* () {
    const session = yield* Layer.build(
      Layer.fresh(
        layerNodeReplicaSync({
          path: ":memory:",
          identity: { organizationId: "org-1", userId: "user-1", replicaId },
          databaseIdentity: `staff-gate-${replicaId}`,
          transport: Layer.succeed(SyncTransportService, unreachable),
          live: { apiBaseUrl: "https://api.example.com", accessToken: async () => null },
        }),
      ),
    );
    const replica = Context.get(session, SqliteReplica);
    const store = yield* RpcTest.makeClient(InventoryStore, { flatten: true }).pipe(
      Effect.provide(
        Layer.fresh(
          layerInventoryStore.pipe(
            Layer.provide(layerNodeStaffGate({ kdfCost: 16 })),
            Layer.provide(NodeCrypto.layer),
            Layer.provide(Layer.succeedContext(session)),
          ),
        ),
      ),
    );
    const category = (yield* store("CreateCategory", { name: "Tablets" })).result;
    const panadol = (yield* store("CreateProductWithBatch", {
      product: { name: "Panadol", categoryId: category.id, unitsPerPack: 1 },
      batch: { packQuantity: 50 },
    })).result;
    const sell = store("IssueInvoice", {
      input: {
        customerName: null,
        items: [
          {
            productId: panadol.product.id,
            batchId: null,
            quantity: 1,
            quantityType: "pack",
            salePrice: 100,
          },
        ],
      },
    });
    const createProduct = (name: string) =>
      store("CreateProduct", { name, categoryId: category.id, unitsPerPack: 1 });
    const state = Stream.runHead(store("StaffState", undefined)).pipe(
      Effect.map((head) => (head._tag === "Some" ? head.value._tag : "none")),
    );
    const attributions = replica.sql.unsafe<{ operationId: string; staffId: string }>(
      `select operationId, staffId from command_staff`,
    );
    const unlock = (staffId: StaffId, digits: string) =>
      store("Unlock", { staffId, pin: pin(digits) });
    return { store, sell, createProduct, state, attributions, unlock };
  });

describe("staff gate", () => {
  it("leaves a solo shop open and unattributed, then enforces the unlocked member's role", () =>
    run(
      Effect.gen(function* () {
        const { store, sell, createProduct, state, attributions, unlock } = yield* openShop("a");
        expect(yield* state).toBe("solo");
        yield* sell;
        yield* createProduct("Brufen");
        expect(yield* attributions).toEqual([]);
        expect(
          yield* reasonOf(store("AddStaff", { name: "A", role: "cashier", pin: pin("1111") })),
        ).toBe("locked");

        yield* store("SetUpOwner", { name: "Owner", pin: pin("1234") });
        expect(yield* state).toBe("unlocked");
        const cashier = yield* store("AddStaff", {
          name: "Cashier",
          role: "cashier",
          pin: pin("4321"),
        });
        expect(
          yield* reasonOf(
            store("AddStaff", { name: "cashier", role: "manager", pin: pin("9999") }),
          ),
        ).toBe("nameTaken");

        yield* store("Lock", undefined);
        expect(yield* state).toBe("locked");
        expect(yield* reasonOf(sell)).toBe("locked");
        expect(yield* reasonOf(createProduct("Disprin"))).toBe("locked");

        yield* unlock(cashier.id, "4321");
        const sale = yield* sell;
        expect(yield* attributions).toEqual([
          { operationId: sale.result.invoiceId, staffId: cashier.id },
        ]);
        expect(yield* reasonOf(createProduct("Disprin"))).toBe("forbidden");
        expect(
          yield* reasonOf(store("AddStaff", { name: "Friend", role: "manager", pin: pin("5555") })),
        ).toBe("forbidden");
      }),
    ));

  it("throttles after five wrong PINs, even for the right PIN, and refuses a removed member", () =>
    run(
      Effect.gen(function* () {
        const { store, unlock } = yield* openShop("b");
        yield* store("SetUpOwner", { name: "Owner", pin: pin("1234") });
        const cashier = yield* store("AddStaff", {
          name: "Cashier",
          role: "cashier",
          pin: pin("4321"),
        });
        const wrong = yield* Effect.forEach([1, 2, 3, 4, 5], () =>
          Effect.flip(unlock(cashier.id, "0000")),
        );
        expect(
          wrong.map((failure) => (failure instanceof StaffRefusal ? failure.reason : failure)),
        ).toEqual(["wrongPin", "wrongPin", "wrongPin", "wrongPin", "throttled"]);
        expect(yield* Effect.flip(unlock(cashier.id, "4321"))).toMatchObject({
          reason: "throttled",
          retryAfterMillis: 30_000,
        });
        yield* TestClock.adjust("29 seconds");
        expect(yield* reasonOf(unlock(cashier.id, "4321"))).toBe("throttled");
        yield* TestClock.adjust("1 second");
        expect(yield* Effect.flip(unlock(cashier.id, "0000"))).toMatchObject({
          reason: "throttled",
          retryAfterMillis: 60_000,
        });
        yield* TestClock.adjust("1 minute");
        expect((yield* unlock(cashier.id, "4321")).id).toBe(cashier.id);

        const owner = yield* store("Unlock", {
          staffId: (yield* Stream.runCollect(Stream.take(store("StaffState", undefined), 1)))
            .flatMap((current) => (current._tag === "unlocked" ? current.staff : []))
            .filter((member) => member.role === "owner")[0]!.id,
          pin: pin("1234"),
        });
        expect(yield* reasonOf(store("RemoveStaff", { id: owner.id }))).toBe("ownerIsFixed");
        yield* store("RemoveStaff", { id: cashier.id });
        expect(yield* reasonOf(unlock(cashier.id, "4321"))).toBe("unknownStaff");
        const events = yield* store("StaffEvents", undefined);
        expect(events.map((event) => [event.kind, event.subject])).toEqual([
          ["staffRemoved", "Cashier"],
          ["unlockThrottled", "Cashier"],
          ["staffAdded", "Cashier"],
          ["ownerSetUp", "Owner"],
        ]);
      }),
    ));

  it("recovers the owner with the code once, and turning staff off returns the shop to solo", () =>
    run(
      Effect.gen(function* () {
        const { store, sell, state, attributions, unlock } = yield* openShop("c");
        const issued = yield* store("SetUpOwner", { name: "Owner", pin: pin("1234") });
        expect(issued.recoveryCode).toMatch(/^([2-9A-HJ-NP-Z]{4}-){4}[2-9A-HJ-NP-Z]{4}$/u);
        yield* store("Lock", undefined);
        const recover = (code: string) =>
          store("RecoverOwner", { recoveryCode: Redacted.make(code), pin: pin("8888") });
        expect(yield* reasonOf(recover("AAAA-AAAA-AAAA-AAAA-AAAA"))).toBe("wrongRecoveryCode");
        const renewed = yield* recover(issued.recoveryCode.replaceAll("-", " ").toLowerCase());
        expect(renewed.recoveryCode).not.toBe(issued.recoveryCode);
        expect(yield* state).toBe("unlocked");
        yield* store("Lock", undefined);
        expect(yield* reasonOf(recover(issued.recoveryCode))).toBe("wrongRecoveryCode");
        const owner = (yield* Stream.runCollect(
          Stream.take(store("StaffState", undefined), 1),
        )).flatMap((current) => (current._tag === "locked" ? current.staff : []))[0]!;
        expect(yield* reasonOf(unlock(owner.id, "1234"))).toBe("wrongPin");
        yield* unlock(owner.id, "8888");

        yield* store("TurnOffStaff", undefined);
        expect(yield* state).toBe("solo");
        expect(yield* reasonOf(unlock(owner.id, "8888"))).toBe("unknownStaff");
        expect(yield* reasonOf(recover(renewed.recoveryCode))).toBe("unknownStaff");
        yield* sell;
        expect(yield* attributions).toEqual([]);
        yield* store("SetUpOwner", { name: "Owner", pin: pin("2468") });
        expect(yield* state).toBe("unlocked");
        expect(yield* reasonOf(store("SetUpOwner", { name: "Second", pin: pin("1357") }))).toBe(
          "alreadySetUp",
        );
      }),
    ));
});
