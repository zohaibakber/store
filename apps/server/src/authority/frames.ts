const utf8 = new TextEncoder();

export const byteLengthOf = (text: string): number => utf8.encode(text).byteLength;

export type CommitFanout = {
  readonly epoch: string;
  readonly horizon: string;
  readonly group: string;
  readonly byteLength: number;
  readonly originReplicaId: string;
};

export type EncodedCommit = {
  readonly json: string;
  readonly fanout: CommitFanout | null;
};

export type StoredChange = {
  readonly entity: string;
  readonly action: "upsert" | "delete";
  readonly entityId: string;
  readonly rowVersion: number;
  readonly rowJson: string;
};

export type StoredReceipt = {
  readonly operationId: string;
  readonly replicaId: string;
  readonly clientSequence: number;
  readonly payloadHash: string;
  readonly decision: "accepted" | "rejected";
  readonly commitSequence: number;
  readonly resultJson: string;
};

const GROUP_OVERHEAD_BYTES = 128;

const CHANGE_OVERHEAD_BYTES = 96;

export const groupByteLength = (operationId: string, changes: ReadonlyArray<StoredChange>) =>
  changes.reduce(
    (total, change) =>
      total +
      CHANGE_OVERHEAD_BYTES +
      byteLengthOf(change.rowJson) +
      byteLengthOf(change.entityId) +
      byteLengthOf(change.entity),
    GROUP_OVERHEAD_BYTES + byteLengthOf(operationId),
  );

export const changeFrame = (change: StoredChange) =>
  `{"entity":${JSON.stringify(change.entity)},"action":${JSON.stringify(change.action)},"entityId":${JSON.stringify(change.entityId)},"rowVersion":${change.rowVersion},"row":${change.rowJson}}`;

export const groupFrame = (
  commitSequence: number,
  operationId: string,
  decision: string,
  changes: ReadonlyArray<StoredChange>,
) =>
  `{"commitSequence":"${commitSequence}","operationId":${JSON.stringify(operationId)},"decision":${JSON.stringify(decision)},"changes":[${changes.map(changeFrame).join(",")}]}`;

export type PageFrame = {
  readonly epoch: string;
  readonly incarnation: string;
  readonly subscription: string;
  readonly transactions: ReadonlyArray<string>;
  readonly nextCommitSequence: string;
  readonly horizon: number;
  readonly retentionFloor: number;
  readonly digestJson: string | undefined;
};

export const pageFrame = (page: PageFrame) =>
  `{"epoch":${JSON.stringify(page.epoch)},"incarnation":${JSON.stringify(page.incarnation)},"subscription":${JSON.stringify(page.subscription)},"schemaVersion":1,"transactions":[${page.transactions.join(",")}],"nextCommitSequence":${JSON.stringify(page.nextCommitSequence)},"horizon":"${page.horizon}","retentionFloor":"${page.retentionFloor}"${page.digestJson === undefined ? "" : `,"digest":${page.digestJson}`}}`;

export const receiptFrame = (receipt: StoredReceipt, pageJson?: string) =>
  `{"operationId":${JSON.stringify(receipt.operationId)},"replicaId":${JSON.stringify(receipt.replicaId)},"clientSequence":"${receipt.clientSequence}","payloadHash":${JSON.stringify(receipt.payloadHash)},"decision":${JSON.stringify(receipt.decision)},"commitSequence":"${receipt.commitSequence}","result":${receipt.resultJson}${pageJson === undefined ? "" : `,"page":${pageJson}`}}`;
