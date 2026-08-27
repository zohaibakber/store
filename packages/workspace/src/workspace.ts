import type { TokenSet } from "@store/auth";
import type { WorkspaceSnapshot } from "@store/contracts";

/** JSON-serializable values accepted at authenticated HTTP boundaries. */
export type JsonSerializable =
  | string
  | number
  | boolean
  | null
  | readonly JsonSerializable[]
  | { readonly [key: string]: JsonSerializable };

export type JsonRequestPayload = JsonSerializable | FormData;
export type JsonRequestInit = Omit<RequestInit, "body"> & { body?: JsonRequestPayload };
export type JsonApiResponse =
  | string
  | number
  | boolean
  | null
  | JsonApiObject
  | readonly JsonApiResponse[];

export interface JsonApiObject {
  readonly [key: string]: JsonApiResponse;
}

export interface WorkspaceAuthAdapter {
  readonly snapshot: WorkspaceSnapshot;
  readonly initialize: () => Promise<WorkspaceSnapshot>;
  readonly adoptSession: (tokens: TokenSet | null) => Promise<WorkspaceSnapshot>;
  readonly renewSession: () => Promise<WorkspaceSnapshot>;
  readonly signOut: () => Promise<void>;
  readonly apiRequest: (pathname: string, init?: JsonRequestInit) => Promise<JsonApiResponse>;
  readonly authRequest: (pathname: string, init?: JsonRequestInit) => Promise<JsonApiResponse>;
}
