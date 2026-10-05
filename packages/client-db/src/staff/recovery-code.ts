const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const GROUP = /.{1,4}/gu;

const SEPARATORS = /[\s-]/gu;

export const RECOVERY_CODE_LENGTH = 20;

export const recoveryCodeFromBytes = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => ALPHABET.charAt(byte % ALPHABET.length)).join("");

export const formatRecoveryCode = (code: string): string => (code.match(GROUP) ?? []).join("-");

export const normalizeRecoveryCode = (submitted: string): string =>
  submitted.replace(SEPARATORS, "").toUpperCase();
