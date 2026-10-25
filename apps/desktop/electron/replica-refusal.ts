import { ReplicaFileRefused } from "../src/host/file-refusal";

export const asFileRefusal = (
  failure: ReplicaFileRefused | { readonly message: string },
): ReplicaFileRefused =>
  failure instanceof ReplicaFileRefused
    ? failure
    : new ReplicaFileRefused({ reason: "failed", detail: failure.message });
