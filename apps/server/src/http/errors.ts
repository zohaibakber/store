import { publicErrorSchema } from "@store/contracts/http-errors";

export const Unauthenticated = publicErrorSchema("Unauthenticated", 401);
export type Unauthenticated = typeof Unauthenticated.Type;

export const Forbidden = publicErrorSchema("Forbidden", 403);
export type Forbidden = typeof Forbidden.Type;

export const publicError = (code: string, message: string) => ({ error: { code, message } });

export const unauthenticated = (code: string, message: string) =>
  Unauthenticated.make(publicError(code, message));
