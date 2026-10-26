import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";

import { createWorkspaceAtoms } from "./atoms";
import { commandAtoms, makeWorkspaceCommands } from "./commands";
import { CatalogOpenFailure } from "./errors";
import { replicaAuthorityOf, type InventoryHost, type InventoryScope } from "./host";
import { makeInventoryLinks } from "./services";

const FIRST_READ_WAIT = "20 seconds";

const openWorkspace = Effect.fn("InventoryWorkspace.open")(function* (
  registry: AtomRegistry.AtomRegistry,
  host: InventoryHost,
  scope: InventoryScope,
) {
  const opened = yield* host.open(
    { organizationId: scope.organizationId, userId: scope.userId, replicaId: host.deviceId },
    registry,
  );
  const links = makeInventoryLinks(opened.services);
  const atoms = createWorkspaceAtoms(opened.services, links, registry);
  const authority = replicaAuthorityOf(scope);
  const commands = makeWorkspaceCommands(links, atoms.storageFull, opened, authority);
  yield* Effect.forEach(
    [
      opened.services.Reads.runtime,
      atoms.storageFull,
      atoms.syncSnapshot,
      atoms.licence,
      ...links.retained,
      ...commandAtoms(commands),
    ] satisfies ReadonlyArray<Atom.Atom<unknown>>,
    (atom) => AtomRegistry.mount(registry, atom),
    { discard: true },
  );
  yield* AtomRegistry.getResult(registry, atoms.syncSnapshot).pipe(
    Effect.mapError(() => new CatalogOpenFailure({ reason: "firstReadFailed" })),
    Effect.timeoutOrElse({
      duration: FIRST_READ_WAIT,
      orElse: () => Effect.fail(new CatalogOpenFailure({ reason: "firstReadTimeout" })),
    }),
  );
  return {
    atoms,
    commands,
    authority,
    deviceId: opened.replicaId ?? host.deviceId,
  };
});

const openRetrySchedule = Schedule.exponential("200 millis").pipe(
  Schedule.jittered,
  Schedule.upTo({ times: 3 }),
);

const openAttempt = Effect.fn("InventoryWorkspace.openAttempt")(function* (
  host: InventoryHost,
  scope: InventoryScope,
) {
  const registry = yield* AtomRegistry.AtomRegistry;
  const attempt = yield* Scope.fork(yield* Effect.scope);
  return yield* openWorkspace(registry, host, scope).pipe(
    Scope.provide(attempt),
    Effect.onError(() => Scope.close(attempt, Exit.void)),
  );
});

export const openCatalog = (host: InventoryHost, scope: InventoryScope) =>
  openAttempt(host, scope).pipe(Effect.retry(openRetrySchedule));
