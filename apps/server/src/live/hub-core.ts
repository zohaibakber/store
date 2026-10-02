import {
  compareDecimalSequence,
  LIVE_SOCKET_CLOSE,
  OPERATIONAL_SUBSCRIPTION,
  SYNC_SCHEMA_VERSION,
} from "@store/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { CommitFanout } from "../inventory/model";

export const HubAttachment = Schema.Struct({
  replicaId: Schema.String,
  userId: Schema.String,
  expiresAt: Schema.Number,
  maxBytes: Schema.NullOr(Schema.Number),
  epoch: Schema.String,
});
export type HubAttachment = typeof HubAttachment.Type;

export const decodeHubAttachment = Schema.decodeUnknownOption(HubAttachment);

export interface HubCursor {
  readonly epoch: string;
  readonly horizon: string;
}

export interface HubSocket {
  readonly attachment: () => HubAttachment | undefined;
  readonly remember: (attachment: HubAttachment) => void;
  readonly send: (text: string) => void;
  readonly close: (code: number, reason: string) => void;
}

const HUB_ADMISSION_HEADERS = {
  replicaId: "x-tabaaq-hub-replica",
  userId: "x-tabaaq-hub-user",
  expiresAt: "x-tabaaq-hub-expires",
  maxBytes: "x-tabaaq-hub-max-bytes",
  epoch: "x-tabaaq-hub-epoch",
  horizon: "x-tabaaq-hub-horizon",
} as const;

export interface HubAdmission {
  readonly replicaId: string;
  readonly userId: string;
  readonly expiresAt: number;
  readonly maxBytes: number | null;
  readonly epoch: string;
  readonly horizon: string;
}

const NonEmpty = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const WholeNumber = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
);

const AdmissionHeaders = Schema.Struct({
  [HUB_ADMISSION_HEADERS.replicaId]: NonEmpty,
  [HUB_ADMISSION_HEADERS.userId]: NonEmpty,
  [HUB_ADMISSION_HEADERS.expiresAt]: WholeNumber,
  [HUB_ADMISSION_HEADERS.maxBytes]: WholeNumber,
  [HUB_ADMISSION_HEADERS.epoch]: NonEmpty,
  [HUB_ADMISSION_HEADERS.horizon]: NonEmpty,
});

const decodeAdmissionHeaders = Schema.decodeUnknownOption(AdmissionHeaders);

export const admissionHeaders = (admission: HubAdmission) => ({
  [HUB_ADMISSION_HEADERS.replicaId]: admission.replicaId,
  [HUB_ADMISSION_HEADERS.userId]: admission.userId,
  [HUB_ADMISSION_HEADERS.expiresAt]: String(admission.expiresAt),
  [HUB_ADMISSION_HEADERS.maxBytes]: String(admission.maxBytes ?? 0),
  [HUB_ADMISSION_HEADERS.epoch]: admission.epoch,
  [HUB_ADMISSION_HEADERS.horizon]: admission.horizon,
});

export const admissionFromHeaders = (
  headers: Readonly<Record<string, string | undefined>>,
): HubAdmission | undefined =>
  decodeAdmissionHeaders(headers).pipe(
    Option.map((value) => ({
      replicaId: value[HUB_ADMISSION_HEADERS.replicaId],
      userId: value[HUB_ADMISSION_HEADERS.userId],
      expiresAt: value[HUB_ADMISSION_HEADERS.expiresAt],
      maxBytes:
        value[HUB_ADMISSION_HEADERS.maxBytes] === 0 ? null : value[HUB_ADMISSION_HEADERS.maxBytes],
      epoch: value[HUB_ADMISSION_HEADERS.epoch],
      horizon: value[HUB_ADMISSION_HEADERS.horizon],
    })),
    Option.getOrUndefined,
  );

export const withoutAdmissionHeaders = (headers: Readonly<Record<string, string>>) =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => !name.startsWith("x-tabaaq-hub-")));

export const replicaTag = (replicaId: string) => `replica:${replicaId}`;

export const userTag = (userId: string) => `user:${userId}`;

const json = (value: string) => JSON.stringify(value);

export const helloFrame = (cursor: HubCursor) =>
  `{"_tag":"hello","epoch":${json(cursor.epoch)},"horizon":${json(cursor.horizon)}}`;

const wakeFrame = (cursor: HubCursor) =>
  `{"_tag":"wake","epoch":${json(cursor.epoch)},"horizon":${json(cursor.horizon)}}`;

const resumeFrame = (cursor: HubCursor) =>
  `{"_tag":"resume","epoch":${json(cursor.epoch)},"reason":"epoch_changed","fromCommitSequence":"0"}`;

const transactionsFrame = (publish: CommitFanout) =>
  `{"_tag":"transactions","epoch":${json(publish.epoch)},"subscription":${json(OPERATIONAL_SUBSCRIPTION)},"schemaVersion":${SYNC_SCHEMA_VERSION},"fromCommitSequence":${json(publish.horizon)},"toCommitSequence":${json(publish.horizon)},"transactions":[${publish.group}]}`;

const carriesGroup = (publish: CommitFanout, attachment: HubAttachment): boolean =>
  publish.group !== "" &&
  (attachment.maxBytes === null || publish.byteLength <= attachment.maxBytes);

export const advanceCursor = (current: HubCursor | undefined, next: HubCursor): HubCursor =>
  current === undefined ||
  current.epoch !== next.epoch ||
  compareDecimalSequence(next.horizon, current.horizon) > 0
    ? next
    : current;

const trySilentClose = (socket: HubSocket, code: number, reason: string) => {
  try {
    socket.close(code, reason);
  } catch {
    return;
  }
};

const trySend = (socket: HubSocket, text: string) => {
  try {
    socket.send(text);
  } catch {
    trySilentClose(socket, LIVE_SOCKET_CLOSE.normal, "send failed");
  }
};

export const closeIfExpired = (socket: HubSocket, now: number): boolean => {
  const attachment = socket.attachment();
  if (attachment !== undefined && attachment.expiresAt > now) return false;
  trySilentClose(socket, LIVE_SOCKET_CLOSE.tokenExpired, "token expired");
  return true;
};

export const publishToSockets = (
  sockets: ReadonlyArray<HubSocket>,
  publish: CommitFanout,
  now: number,
): number => {
  const cursor = { epoch: publish.epoch, horizon: publish.horizon };
  let frame: string | undefined;
  let wake: string | undefined;
  let delivered = 0;
  for (const socket of sockets) {
    if (closeIfExpired(socket, now)) continue;
    const attachment = socket.attachment();
    if (attachment === undefined) continue;
    if (attachment.epoch !== publish.epoch) {
      socket.remember({ ...attachment, epoch: publish.epoch });
    }
    if (attachment.replicaId === publish.originReplicaId) continue;
    if (attachment.epoch !== publish.epoch) {
      trySend(socket, resumeFrame(cursor));
    } else if (carriesGroup(publish, attachment)) {
      frame ??= transactionsFrame(publish);
      trySend(socket, frame);
    } else {
      wake ??= wakeFrame(cursor);
      trySend(socket, wake);
    }
    delivered += 1;
  }
  return delivered;
};

export const closeSockets = (sockets: ReadonlyArray<HubSocket>, code: number, reason: string) => {
  for (const socket of sockets) trySilentClose(socket, code, reason);
  return sockets.length;
};
