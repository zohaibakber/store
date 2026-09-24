import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import * as Schema from "effect/Schema";

import { Sha256Hex } from "./model.ts";

const decodeSha256Hex = Schema.decodeUnknownSync(Sha256Hex);

export const checksumValue = <Value>(value: Value): Sha256Hex =>
  decodeSha256Hex(canonicalPayloadHash(value));
