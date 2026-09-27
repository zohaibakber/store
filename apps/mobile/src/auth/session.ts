export type SignedInSession = {
  readonly status: "signedIn";
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly authenticatedFetch: typeof fetch;
  readonly signOut: () => Promise<void>;
};

export type SessionOrganization = {
  readonly id: string;
  readonly name: string;
  readonly role: string;
};

export type Session =
  | { readonly status: "loading" }
  | { readonly status: "signedOut"; readonly notice?: string }
  | {
      readonly status: "needsOrganization";
      readonly userId: string;
      readonly email: string;
      readonly displayName: string;
      readonly organization: SessionOrganization | null;
      readonly signOut: () => Promise<void>;
    }
  | SignedInSession;
