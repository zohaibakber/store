import {
  CommandReceipt,
  SyncCommandEnvelope,
  SyncEntity,
  SyncSubscription,
  type SyncProtocolError,
} from "@store/contracts";
import { replicaEntitySchemas } from "@store/contracts/sync/replica-model";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { checkStoredEnvelope } from "./decisions";
import { ReplicaStorageError } from "./errors";

const EnvelopeJson = Schema.fromJsonString(SyncCommandEnvelope);

export const decodeEnvelopeJson = <E>(json: string, onError: (message: string) => E) =>
  Schema.decodeUnknownEffect(EnvelopeJson)(json).pipe(
    Effect.mapError((error) => onError(error.message)),
  );

type StoredOutboxRow = {
  readonly operationId: string;
  readonly clientSequence: string;
  readonly envelopeJson: string;
};

export const decodeOutboxEnvelope = <E>(
  row: StoredOutboxRow,
  onError: (message: string) => E,
): Effect.Effect<SyncCommandEnvelope, E | SyncProtocolError> =>
  decodeEnvelopeJson(row.envelopeJson, onError).pipe(
    Effect.flatMap((envelope) => Effect.fromResult(checkStoredEnvelope(row, envelope))),
  );

export const decodeStoredEnvelope = (row: StoredOutboxRow) =>
  decodeOutboxEnvelope(row, (message) => ReplicaStorageError.make({ message }));

export const encodeEnvelopeJson = Schema.encodeSync(EnvelopeJson);

export const encodeReceiptJson = Schema.encodeSync(Schema.fromJsonString(CommandReceipt));

export const encodeRowJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export const decodeRowJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

export const decodeEntity = Schema.decodeUnknownSync(SyncEntity);

export const decodeInvoiceRow = Schema.decodeUnknownSync(replicaEntitySchemas.invoice);

export const decodeCategoryRow = Schema.decodeUnknownSync(replicaEntitySchemas.category);

export const decodeSubscription = Schema.decodeUnknownOption(SyncSubscription);
