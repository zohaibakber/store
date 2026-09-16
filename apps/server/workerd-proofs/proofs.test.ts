import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const proof = (name: string) => env.PROOF.get(env.PROOF.idFromName(name));

describe("workerd sync proofs", () => {
  it("commits a last-unit sale through drizzle durable-sqlite", async () => {
    const result = await proof("sale").lastUnitSale();
    expect(result).toEqual({
      decision: "accepted",
      unitQuantity: 0,
      invoiceCount: 1,
    });
  });

  it("rolls back a drizzle write when the transaction callback throws", async () => {
    const result = await proof("throw").drizzleThrowRollsBack();
    expect(result.threw).toBe(true);
    expect(result.categoryCount).toBe(1);
  });

  it("rolls back a write inside storage.transactionSync", async () => {
    const result = await proof("sync").storageTransactionRollsBack();
    expect(result.threw).toBe(true);
    expect(result.categoryCount).toBe(1);
  });

  it("fires a durable object alarm", async () => {
    const stub = proof("alarm");
    expect(await stub.armAlarm()).toBe(true);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await stub.alarmFired()).toBe(true);
  });

  it("keeps refusal data across RPC and replaces functions with stubs", async () => {
    const payload = {
      _tag: "SyncProtocolError",
      message: "cloned",
      describe: () => "method",
    };
    const received = await proof("rpc").echoRpc(payload);
    expect(received._tag).toBe("SyncProtocolError");
    expect(received.message).toBe("cloned");
    expect(received.describe === payload.describe).toBe(false);
  });

  it("round-trips snapshot bytes through R2", async () => {
    const stub = proof("r2");
    await stub.putSnapshot("part-1", "snapshot-part");
    expect(await stub.getSnapshot("part-1")).toBe("snapshot-part");
  });

  it("keeps a hibernated websocket attachment across eviction", async () => {
    const stub = proof("live");
    const response = await stub.fetch("https://proof.local/live", {
      headers: { Upgrade: "websocket" },
    });
    const socket = response.webSocket;
    expect(socket).toBeDefined();
    socket?.accept();
    await evictDurableObject(stub);
    const attachment = await runInDurableObject(stub, (instance) => instance.liveAttachment());
    expect(attachment).toEqual({ replicaId: "replica-live" });
  });
});
