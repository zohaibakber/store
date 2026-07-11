import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { expect, test } from "vitest";
import { layer, program } from "./index";

test("CRUD remains available without sync configuration", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-offline-"));
  const runtime = ManagedRuntime.make(layer({ path: path.join(directory, "notes.db") }));

  try {
    const created = await runtime.runPromise(
      program.createNote({ title: "  Offline first  ", body: "  local write  " }),
    );
    expect(created.title).toBe("Offline first");
    expect(await runtime.runPromise(program.listNotes)).toEqual([created]);

    const updated = await runtime.runPromise(
      program.updateNote({ id: created.id, title: "Updated", body: "Still local" }),
    );
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.title).toBe("Updated");

    await runtime.runPromise(program.deleteNote(created.id));
    expect(await runtime.runPromise(program.listNotes)).toEqual([]);
    expect(await runtime.runPromise(program.getSyncStatus)).toMatchObject({
      configured: false,
      phase: "local-only",
    });
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
