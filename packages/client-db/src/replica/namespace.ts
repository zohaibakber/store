const fnv1a = (value: string): string => {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01_00_01_93);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const inventoryOrganizationObjectReplicaName = (scopeId: string): string =>
  `inventory-replica-${fnv1a(scopeId)}.sqlite`;
