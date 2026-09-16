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

  it("rolls back an invoice command when sqlite aborts the transaction", async () => {
    const result = await proof("trigger").commandTriggerRollsBack();
    expect(result.threw).toBe(true);
    expect(result.unitQuantity).toBe(1);
    expect(result.invoiceCount).toBe(0);
  });

  it("fires a durable object alarm", async () => {
    const stub = proof("alarm");
    expect(await stub.armAlarm()).toBe(true);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await stub.alarmFired()).toBe(true);
  });

  it("drops functions across RPC structured clone", async () => {
    const payload = {
      _tag: "SyncProtocolError",
      message: "cloned",
      describe: () => "method",
    };
    const received = await proof("rpc").echoRpc(payload);
    expect(received).toEqual({ _tag: "SyncProtocolError", message: "cloned" });
    expect("describe" in received).toBe(false);
  });

  it("round-trips snapshot bytes through R2", async () => {
    const stub = proof("r2");
    const bytes = new TextEncoder().encode("snapshot-part").buffer;
    await stub.putSnapshot("part-1", bytes);
    const stored = await stub.getSnapshot("part-1");
    expect(stored).not.toBeNull();
    expect(new TextDecoder().decode(stored ?? new ArrayBuffer(0))).toBe("snapshot-part");
  });

  it("keeps a hibernated websocket attachment across eviction", async () => {
    const stub = proof("live");
    const response = await stub.fetch("https://proof.local/live");
    const socket = response.webSocket;
    expect(socket).toBeDefined();
    socket?.accept();
    await evictDurableObject(stub);
    const attachment = await runInDurableObject(stub, (instance) => instance.liveAttachment());
    expect(attachment).toEqual({ replicaId: "replica-live" });
  });
});
