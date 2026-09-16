import { createHash } from "node:crypto";

import { canonicalJson } from "@store/contracts/canonical-json";
import * as Schema from "effect/Schema";

import { Sha256Hex } from "./model.ts";

export const sha256Hex = (value: string): Sha256Hex =>
  Schema.decodeUnknownSync(Sha256Hex)(createHash("sha256").update(value).digest("hex"));

export const checksumValue = <Value>(value: Value): Sha256Hex => {
  const encoded = canonicalJson(value);
  if (encoded === undefined) {
    return sha256Hex("null");
  }
  return sha256Hex(encoded);
};
