export type { ClerkOrganizationMembership, ClerkVerifiedClaims, ClerkVerifyConfig } from "./clerk";
export {
  accessTokenFromUrl,
  bearerTokenFromHeaders,
  headersWithAccessToken,
  loadClerkOrganizationMemberships,
  loadClerkUserProfile,
  makeClerkBackend,
  verifyClerkBearerToken,
} from "./clerk";
export type {
  OrganizationBinding,
  OrganizationBindingStore,
  ResolvedStoreOrganization,
  StoreOrganizationBindingSource,
} from "./store-organization";
export { mapClerkOrganizationRole, resolveStoreOrganizationId } from "./store-organization";
export { resolveAuthSecurity } from "./security";

export interface AuthUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
}

export interface AuthSessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly activeOrganizationId: string | null;
  readonly clerkOrganizationId: string | null;
  readonly expiresAt: number;
}

export interface AuthOrganizationMembership {
  readonly id: string;
  readonly clerkOrganizationId: string;
  readonly name: string;
  readonly slug: string | null;
  readonly role: string;
}

export interface AuthSession {
  readonly user: AuthUser;
  readonly session: AuthSessionRecord;
  readonly organizations: ReadonlyArray<AuthOrganizationMembership>;
}
