import * as ExpoCrypto from "expo-crypto";

export const mintReplicaIdCandidate = (): string => ExpoCrypto.randomUUID();
