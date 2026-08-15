export type MobileSyncOperation<Change> = {
  operationId: string;
  organizationId: string;
  deviceId: string;
  actorUserId: string;
  clientSequence: number;
  occurredAt: number;
  payloadHash: string;
  changes: ReadonlyArray<Change>;
};

type OperationHasher<Change> = (
  operation: Omit<MobileSyncOperation<Change>, "payloadHash">,
) => Promise<string>;

/**
 * Clerk migration changed user identifiers without changing the person or
 * organization. Pending local mutations must therefore be attributed to the
 * currently authenticated uploader and rehashed before the server can accept
 * them.
 */
export const reattributePendingOperations = async <Change>(
  operations: ReadonlyArray<MobileSyncOperation<Change>>,
  actorUserId: string,
  hash: OperationHasher<Change>,
): Promise<{ operations: Array<MobileSyncOperation<Change>>; changed: boolean }> => {
  let changed = false;
  const migrated: Array<MobileSyncOperation<Change>> = [];
  for (const operation of operations) {
    if (operation.actorUserId === actorUserId) {
      migrated.push(operation);
      continue;
    }
    const { payloadHash: _oldPayloadHash, ...unhashed } = operation;
    const reattributed = { ...unhashed, actorUserId };
    migrated.push({ ...reattributed, payloadHash: await hash(reattributed) });
    changed = true;
  }
  return { operations: migrated, changed };
};
