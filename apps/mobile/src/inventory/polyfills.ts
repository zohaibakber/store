import * as ExpoCrypto from "expo-crypto";

type IntegerTypedArray =
  | Int8Array
  | Int16Array
  | Int32Array
  | Uint8Array
  | Uint8ClampedArray
  | Uint16Array
  | Uint32Array;

type UuidString = `${string}-${string}-${string}-${string}-${string}`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const isIntegerTypedArray = (value: ArrayBufferView | null): value is IntegerTypedArray =>
  value instanceof Int8Array ||
  value instanceof Int16Array ||
  value instanceof Int32Array ||
  value instanceof Uint8Array ||
  value instanceof Uint8ClampedArray ||
  value instanceof Uint16Array ||
  value instanceof Uint32Array;

const isUuid = (value: string): value is UuidString => UUID_PATTERN.test(value);

function getRandomValues<T extends ArrayBufferView | null>(array: T): T {
  if (!isIntegerTypedArray(array)) {
    throw new TypeError("crypto.getRandomValues requires an integer typed array.");
  }
  ExpoCrypto.getRandomValues(array);
  return array;
}

function randomUUID(): UuidString {
  const value = ExpoCrypto.randomUUID();
  if (!isUuid(value)) throw new TypeError("expo-crypto returned a malformed UUID.");
  return value;
}

const installCrypto = () => {
  const existing: Partial<Crypto> | undefined = globalThis.crypto;
  if (existing === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      enumerable: true,
      value: { getRandomValues, randomUUID },
    });
    return;
  }
  if (!("getRandomValues" in existing)) {
    Object.defineProperty(existing, "getRandomValues", {
      configurable: true,
      value: getRandomValues,
    });
  }
  if (!("randomUUID" in existing)) {
    Object.defineProperty(existing, "randomUUID", { configurable: true, value: randomUUID });
  }
};

installCrypto();
