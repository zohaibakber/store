import type { Account } from "./model";

export type LiveAccessToken = (options: { readonly force: boolean }) => Promise<string | null>;

export type SignedInSession = {
  readonly status: "signedIn";
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly authenticatedFetch: typeof fetch;
  readonly liveAccessToken: LiveAccessToken;
  readonly signOut: () => Promise<void>;
};

export type Session =
  | { readonly status: "loading" }
  | { readonly status: "signedOut"; readonly notice?: string }
  | {
      readonly status: "needsOrganization";
      readonly userId: string;
      readonly email: string;
      readonly displayName: string;
      readonly organization: Account["organization"];
      readonly signOut: () => Promise<void>;
    }
  | SignedInSession;
