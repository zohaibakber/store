import {
  DEFAULT_AUTO_LOCK_MINUTES,
  MAX_STAFF_EVENTS,
  MAX_STAFF_MEMBERS,
  roleAllows,
  StaffEventKind,
  StaffId,
  StaffRefusal,
  StaffRole,
  type StaffEvent,
  type StaffMember,
  type StaffPermission,
  type StaffRefusalReason,
  type StaffState,
} from "@store/contracts";
import { ReplicaStorageError } from "@store/contracts/replica";
import { staff, staffEvents, staffSettings } from "@store/db/replica.schema";
import { runReplicaTransaction, SqliteReplica } from "@store/sync/sql-client";
import { desc, eq } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { readFailure } from "../store/failures";
import { StaffGate } from "../store/staff-gate";
import {
  formatRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_LENGTH,
  recoveryCodeFromBytes,
} from "./recovery-code";
import {
  afterWrongAttempt,
  NO_FAILED_ATTEMPTS,
  remainingThrottleMillis,
  THROTTLE_AFTER_ATTEMPTS,
  type AttemptCounters,
} from "./throttle";
import { sealSecret, STAFF_KDF_COST, verifySecret } from "./verifier";

export { STAFF_KDF_COST } from "./verifier";

const SETTINGS_ID = "singleton";

const StaffRow = Schema.Struct({
  id: StaffId,
  name: Schema.String,
  role: StaffRole,
  pinVerifier: Schema.String,
  failedAttempts: Schema.Number,
  lockedUntil: Schema.Number,
  active: Schema.Boolean,
});
type StaffRow = typeof StaffRow.Type;

const decodeStaffRows = Schema.decodeUnknownEffect(Schema.Array(StaffRow));

const EventRow = Schema.Struct({
  seq: Schema.Number,
  at: Schema.Number,
  kind: StaffEventKind,
  actorId: Schema.NullOr(Schema.String),
  subjectId: Schema.NullOr(Schema.String),
  fromStaffId: Schema.NullOr(Schema.String),
});

const decodeEventRows = Schema.decodeUnknownEffect(Schema.Array(EventRow));

type EventInput = {
  readonly kind: StaffEventKind;
  readonly actorId?: StaffId;
  readonly subjectId?: string;
  readonly fromStaffId?: StaffId;
};

const memberOf = (row: StaffRow): StaffMember => ({ id: row.id, name: row.name, role: row.role });

const sameName = (left: string, right: string) =>
  left.trim().toLowerCase() === right.trim().toLowerCase();

const ownerFirstThenName = (left: StaffMember, right: StaffMember) =>
  Number(right.role === "owner") - Number(left.role === "owner") ||
  left.name.localeCompare(right.name, undefined, { sensitivity: "base" });

const rosterOf = (rows: ReadonlyArray<StaffRow>): ReadonlyArray<StaffMember> =>
  rows
    .filter((row) => row.active)
    .map(memberOf)
    .sort(ownerFirstThenName);

const stateOf = (
  rows: ReadonlyArray<StaffRow>,
  actorId: Option.Option<StaffId>,
  autoLockMinutes: number,
): StaffState => {
  const roster = rosterOf(rows);
  if (!roster.some((member) => member.role === "owner")) return { _tag: "solo" };
  const actor = roster.find((member) => Option.contains(actorId, member.id));
  return actor === undefined
    ? { _tag: "locked", staff: roster }
    : { _tag: "unlocked", actor, staff: roster, autoLockMinutes };
};

const refuse = (reason: StaffRefusalReason) => new StaffRefusal({ reason });

export const layerNodeStaffGate = (options?: {
  readonly kdfCost?: number;
}): Layer.Layer<StaffGate, ReplicaStorageError, SqliteReplica | Crypto.Crypto> =>
  Layer.effect(
    StaffGate,
    Effect.gen(function* () {
      const replica = yield* SqliteReplica;
      const crypto = yield* Crypto.Crypto;
      const turn = yield* Semaphore.make(1);
      const oneAtATime = <A, E, R>(work: Effect.Effect<A, E, R>) => turn.withPermit(work);
      const kdfCost = options?.kdfCost ?? STAFF_KDF_COST;

      const stored = <A, E>(effect: Effect.Effect<A, E>) => Effect.mapError(effect, readFailure);

      const transact = <A, E>(work: Effect.Effect<A, E>) =>
        stored(runReplicaTransaction(replica, () => work));

      const seal = (secret: Redacted.Redacted<string>) =>
        sealSecret(secret, kdfCost).pipe(Effect.provideService(Crypto.Crypto, crypto));

      const newStaffId = crypto.randomUUIDv4.pipe(
        Effect.orDie,
        Effect.map((id) => StaffId.make(id)),
      );

      const issueRecoveryCode = Effect.gen(function* () {
        const code = recoveryCodeFromBytes(
          yield* Effect.orDie(crypto.randomBytes(RECOVERY_CODE_LENGTH)),
        );
        return { verifier: yield* seal(Redacted.make(code)), shown: formatRecoveryCode(code) };
      });

      const readRows = stored(
        replica.db
          .select({
            id: staff.id,
            name: staff.name,
            role: staff.role,
            pinVerifier: staff.pinVerifier,
            failedAttempts: staff.failedAttempts,
            lockedUntil: staff.lockedUntil,
            active: staff.active,
          })
          .from(staff)
          .all()
          .pipe(Effect.flatMap(decodeStaffRows)),
      );

      const readSettings = stored(
        replica.db.select().from(staffSettings).where(eq(staffSettings.id, SETTINGS_ID)).all(),
      ).pipe(Effect.map((rows) => Option.fromNullishOr(rows[0])));

      const readState = (actorId: Option.Option<StaffId>) =>
        Effect.gen(function* () {
          const settings = yield* readSettings;
          return stateOf(
            yield* readRows,
            actorId,
            Option.match(settings, {
              onNone: () => DEFAULT_AUTO_LOCK_MINUTES,
              onSome: (row) => row.autoLockMinutes,
            }),
          );
        });

      const state = yield* SubscriptionRef.make(yield* readState(Option.none()));

      const publish = (actorId: Option.Option<StaffId>) =>
        Effect.flatMap(readState(actorId), (next) => SubscriptionRef.set(state, next));

      const record = Effect.fnUntraced(function* (event: EventInput) {
        const at = yield* Clock.currentTimeMillis;
        yield* replica.db.insert(staffEvents).values({
          at,
          kind: event.kind,
          actorId: event.actorId ?? null,
          subjectId: event.subjectId ?? null,
          fromStaffId: event.fromStaffId ?? null,
        });
      });

      const actorAllowed = Effect.fnUntraced(function* (permission: StaffPermission) {
        const current = yield* SubscriptionRef.get(state);
        if (current._tag !== "unlocked") return yield* refuse("locked");
        if (!roleAllows(current.actor.role, permission)) return yield* refuse("forbidden");
        return current.actor;
      });

      const authorize = Effect.fn("StaffGate.authorize")(function* (permission: StaffPermission) {
        const current = yield* SubscriptionRef.get(state);
        if (current._tag === "solo") return Option.none<StaffId>();
        return Option.some((yield* actorAllowed(permission)).id);
      });

      const attempt = Effect.fnUntraced(function* (input: {
        readonly counters: AttemptCounters;
        readonly verifier: string;
        readonly secret: Redacted.Redacted<string>;
        readonly wrong: "wrongPin" | "wrongRecoveryCode";
        readonly subjectId: StaffId;
        readonly persist: (counters: AttemptCounters) => Effect.Effect<unknown, unknown>;
      }) {
        const now = yield* Clock.currentTimeMillis;
        const remaining = remainingThrottleMillis(input.counters, now);
        if (remaining > 0) {
          return yield* new StaffRefusal({ reason: "throttled", retryAfterMillis: remaining });
        }
        if (yield* verifySecret(input.verifier, input.secret)) return;
        const next = afterWrongAttempt(input.counters, now);
        yield* transact(
          Effect.gen(function* () {
            yield* input.persist(next.counters);
            if (next.counters.failedAttempts === THROTTLE_AFTER_ATTEMPTS) {
              yield* record({ kind: "unlockThrottled", subjectId: input.subjectId });
            }
          }),
        );
        return yield* next.windowMillis === 0
          ? refuse(input.wrong)
          : new StaffRefusal({ reason: "throttled", retryAfterMillis: next.windowMillis });
      });

      const setPinCounters = (id: StaffId, counters: AttemptCounters) =>
        replica.db.update(staff).set(counters).where(eq(staff.id, id));

      const setRecoveryCounters = (counters: AttemptCounters) =>
        replica.db
          .update(staffSettings)
          .set({
            recoveryFailedAttempts: counters.failedAttempts,
            recoveryLockedUntil: counters.lockedUntil,
          })
          .where(eq(staffSettings.id, SETTINGS_ID));

      const setUpOwner = Effect.fn("StaffGate.setUpOwner")(function* ({
        name,
        pin,
      }: {
        readonly name: string;
        readonly pin: Redacted.Redacted<string>;
      }) {
        const rows = yield* readRows;
        if (rows.some((row) => row.active)) return yield* refuse("alreadySetUp");
        const id = yield* newStaffId;
        const pinVerifier = yield* seal(pin);
        const recovery = yield* issueRecoveryCode;
        const now = yield* Clock.currentTimeMillis;
        const settings = {
          autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
          recoveryVerifier: recovery.verifier,
          recoveryFailedAttempts: 0,
          recoveryLockedUntil: 0,
        };
        yield* transact(
          Effect.gen(function* () {
            yield* replica.db
              .insert(staff)
              .values({ id, name, role: "owner", pinVerifier, createdAt: now, updatedAt: now });
            yield* replica.db
              .insert(staffSettings)
              .values({ id: SETTINGS_ID, ...settings })
              .onConflictDoUpdate({ target: staffSettings.id, set: settings });
            yield* record({ kind: "ownerSetUp", actorId: id, subjectId: id });
          }),
        );
        yield* publish(Option.some(id));
        return { recoveryCode: recovery.shown };
      }, oneAtATime);

      const unlock = Effect.fn("StaffGate.unlock")(function* ({
        staffId,
        pin,
      }: {
        readonly staffId: StaffId;
        readonly pin: Redacted.Redacted<string>;
      }) {
        const rows = yield* readRows;
        const member = rows.find((row) => row.active && row.id === staffId);
        if (member === undefined) return yield* refuse("unknownStaff");
        yield* attempt({
          counters: member,
          verifier: member.pinVerifier,
          secret: pin,
          wrong: "wrongPin",
          subjectId: member.id,
          persist: (counters) => setPinCounters(member.id, counters),
        });
        if (member.failedAttempts > 0) {
          yield* stored(setPinCounters(member.id, NO_FAILED_ATTEMPTS));
        }
        yield* publish(Option.some(member.id));
        return memberOf(member);
      }, oneAtATime);

      const lock = SubscriptionRef.update(state, (current): StaffState =>
        current._tag === "unlocked" ? { _tag: "locked", staff: current.staff } : current,
      ).pipe(oneAtATime, Effect.withSpan("StaffGate.lock"));

      const addStaff = Effect.fn("StaffGate.addStaff")(function* ({
        name,
        role,
        pin,
      }: {
        readonly name: string;
        readonly role: "manager" | "cashier";
        readonly pin: Redacted.Redacted<string>;
      }) {
        const actor = yield* actorAllowed("manageShop");
        const active = (yield* readRows).filter((row) => row.active);
        if (active.length >= MAX_STAFF_MEMBERS) return yield* refuse("tooManyStaff");
        if (active.some((row) => sameName(row.name, name))) return yield* refuse("nameTaken");
        const id = yield* newStaffId;
        const pinVerifier = yield* seal(pin);
        const now = yield* Clock.currentTimeMillis;
        yield* transact(
          Effect.gen(function* () {
            yield* replica.db
              .insert(staff)
              .values({ id, name, role, pinVerifier, createdAt: now, updatedAt: now });
            yield* record({ kind: "staffAdded", actorId: actor.id, subjectId: id });
          }),
        );
        yield* publish(Option.some(actor.id));
        return { id, name, role } satisfies StaffMember;
      }, oneAtATime);

      const updateStaff = Effect.fn("StaffGate.updateStaff")(function* ({
        id,
        name,
        role,
        pin,
      }: {
        readonly id: StaffId;
        readonly name: string;
        readonly role: StaffRole;
        readonly pin?: Redacted.Redacted<string>;
      }) {
        const actor = yield* actorAllowed("manageShop");
        const active = (yield* readRows).filter((row) => row.active);
        const member = active.find((row) => row.id === id);
        if (member === undefined) return yield* refuse("unknownStaff");
        if ((member.role === "owner") !== (role === "owner")) return yield* refuse("ownerIsFixed");
        if (active.some((row) => row.id !== id && sameName(row.name, name))) {
          return yield* refuse("nameTaken");
        }
        const renamedOrMoved = member.name !== name || member.role !== role;
        const pinVerifier = pin === undefined ? undefined : yield* seal(pin);
        if (!renamedOrMoved && pinVerifier === undefined) return memberOf(member);
        const now = yield* Clock.currentTimeMillis;
        const renamed = { name, role, updatedAt: now };
        const changes =
          pinVerifier === undefined ? renamed : { ...renamed, pinVerifier, ...NO_FAILED_ATTEMPTS };
        yield* transact(
          Effect.gen(function* () {
            yield* replica.db.update(staff).set(changes).where(eq(staff.id, id));
            if (renamedOrMoved) {
              yield* record({ kind: "staffUpdated", actorId: actor.id, subjectId: id });
            }
            if (pinVerifier !== undefined) {
              yield* record({ kind: "pinChanged", actorId: actor.id, subjectId: id });
            }
          }),
        );
        yield* publish(Option.some(actor.id));
        return { id, name, role } satisfies StaffMember;
      }, oneAtATime);

      const removeStaff = Effect.fn("StaffGate.removeStaff")(function* ({
        id,
      }: {
        readonly id: StaffId;
      }) {
        const actor = yield* actorAllowed("manageShop");
        const member = (yield* readRows).find((row) => row.active && row.id === id);
        if (member === undefined) return yield* refuse("unknownStaff");
        if (member.role === "owner") return yield* refuse("ownerIsFixed");
        const now = yield* Clock.currentTimeMillis;
        yield* transact(
          Effect.gen(function* () {
            yield* replica.db
              .update(staff)
              .set({ active: false, updatedAt: now })
              .where(eq(staff.id, id));
            yield* record({ kind: "staffRemoved", actorId: actor.id, subjectId: id });
          }),
        );
        yield* publish(Option.some(actor.id));
      }, oneAtATime);

      const turnOffStaff = Effect.fn("StaffGate.turnOffStaff")(function* () {
        const actor = yield* actorAllowed("manageShop");
        const now = yield* Clock.currentTimeMillis;
        yield* transact(
          Effect.gen(function* () {
            yield* replica.db
              .update(staff)
              .set({ active: false, updatedAt: now })
              .where(eq(staff.active, true));
            yield* replica.db.delete(staffSettings);
            yield* record({ kind: "staffTurnedOff", actorId: actor.id });
          }),
        );
        yield* publish(Option.none());
      }, oneAtATime);

      const recoverOwner = Effect.fn("StaffGate.recoverOwner")(function* ({
        recoveryCode,
        pin,
      }: {
        readonly recoveryCode: Redacted.Redacted<string>;
        readonly pin: Redacted.Redacted<string>;
      }) {
        const owner = (yield* readRows).find((row) => row.active && row.role === "owner");
        if (owner === undefined) return yield* refuse("unknownStaff");
        const settings = yield* readSettings;
        if (Option.isNone(settings)) {
          return yield* new ReplicaStorageError({ message: "Staff settings are missing." });
        }
        yield* attempt({
          counters: {
            failedAttempts: settings.value.recoveryFailedAttempts,
            lockedUntil: settings.value.recoveryLockedUntil,
          },
          verifier: settings.value.recoveryVerifier,
          secret: Redacted.make(normalizeRecoveryCode(Redacted.value(recoveryCode))),
          wrong: "wrongRecoveryCode",
          subjectId: owner.id,
          persist: setRecoveryCounters,
        });
        const pinVerifier = yield* seal(pin);
        const recovery = yield* issueRecoveryCode;
        const now = yield* Clock.currentTimeMillis;
        yield* transact(
          Effect.gen(function* () {
            yield* replica.db
              .update(staff)
              .set({ pinVerifier, updatedAt: now, ...NO_FAILED_ATTEMPTS })
              .where(eq(staff.id, owner.id));
            yield* replica.db
              .update(staffSettings)
              .set({
                recoveryVerifier: recovery.verifier,
                recoveryFailedAttempts: 0,
                recoveryLockedUntil: 0,
              })
              .where(eq(staffSettings.id, SETTINGS_ID));
            yield* record({ kind: "ownerRecovered", actorId: owner.id, subjectId: owner.id });
          }),
        );
        yield* publish(Option.some(owner.id));
        return { recoveryCode: recovery.shown };
      }, oneAtATime);

      const renewRecoveryCode = Effect.fn("StaffGate.renewRecoveryCode")(function* () {
        const actor = yield* actorAllowed("manageShop");
        const recovery = yield* issueRecoveryCode;
        yield* transact(
          Effect.gen(function* () {
            yield* replica.db
              .update(staffSettings)
              .set({
                recoveryVerifier: recovery.verifier,
                recoveryFailedAttempts: 0,
                recoveryLockedUntil: 0,
              })
              .where(eq(staffSettings.id, SETTINGS_ID));
            yield* record({ kind: "recoveryCodeRenewed", actorId: actor.id, subjectId: actor.id });
          }),
        );
        return { recoveryCode: recovery.shown };
      }, oneAtATime);

      const setAutoLock = Effect.fn("StaffGate.setAutoLock")(function* ({
        minutes,
      }: {
        readonly minutes: number;
      }) {
        const actor = yield* actorAllowed("manageShop");
        yield* transact(
          Effect.gen(function* () {
            yield* replica.db
              .update(staffSettings)
              .set({ autoLockMinutes: minutes })
              .where(eq(staffSettings.id, SETTINGS_ID));
            yield* record({ kind: "autoLockChanged", actorId: actor.id });
          }),
        );
        yield* publish(Option.some(actor.id));
      }, oneAtATime);

      const staffEventsOf = Effect.fn("StaffGate.staffEvents")(function* () {
        yield* actorAllowed("manageShop");
        const names = new Map((yield* readRows).map((row) => [String(row.id), row.name]));
        const nameOf = (id: string | null) => (id === null ? null : (names.get(id) ?? null));
        const events = yield* stored(
          replica.db
            .select()
            .from(staffEvents)
            .orderBy(desc(staffEvents.seq))
            .limit(MAX_STAFF_EVENTS)
            .all()
            .pipe(Effect.flatMap(decodeEventRows)),
        );
        return events.map((event): StaffEvent => ({
          id: event.seq,
          at: event.at,
          kind: event.kind,
          actor: nameOf(event.actorId),
          subject: nameOf(event.kind === "draftHandedOver" ? event.fromStaffId : event.subjectId),
        }));
      }, oneAtATime);

      const handOverDraft = Effect.fn("StaffGate.handOverDraft")(function* ({
        draftId,
        from,
      }: {
        readonly draftId: string;
        readonly from: StaffId;
      }) {
        const actor = yield* actorAllowed("manageStock");
        const known = (yield* readRows).some((row) => row.id === from);
        if (!known || from === actor.id) return yield* refuse("unknownStaff");
        yield* stored(
          record({
            kind: "draftHandedOver",
            actorId: actor.id,
            subjectId: draftId,
            fromStaffId: from,
          }),
        );
      }, oneAtATime);

      return StaffGate.of({
        handlers: {
          StaffState: () => SubscriptionRef.changes(state),
          SetUpOwner: setUpOwner,
          Unlock: unlock,
          Lock: () => lock,
          AddStaff: addStaff,
          UpdateStaff: updateStaff,
          RemoveStaff: removeStaff,
          TurnOffStaff: turnOffStaff,
          RecoverOwner: recoverOwner,
          RenewRecoveryCode: renewRecoveryCode,
          SetAutoLock: setAutoLock,
          StaffEvents: staffEventsOf,
          HandOverDraft: handOverDraft,
        },
        authorize,
      });
    }),
  );
