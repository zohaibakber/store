import { createClerkClient, verifyToken } from "@clerk/backend";

export interface ClerkVerifyConfig {
  readonly secretKey: string;
  readonly jwtKey?: string;
  readonly jwtAudience?: string;
  readonly authorizedParties?: ReadonlyArray<string>;
}

export interface ClerkVerifiedClaims {
  readonly userId: string;
  readonly sessionId: string;
  readonly clerkOrganizationId: string | null;
  readonly organizationRole: string | null;
  readonly organizationSlug: string | null;
  readonly email: string | null;
  readonly name: string | null;
  readonly image: string | null;
}

export interface ClerkOrganizationMembership {
  readonly clerkOrganizationId: string;
  readonly name: string;
  readonly slug: string | null;
  readonly role: string;
}

const textClaim = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

const recordClaim = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const organizationRoleClaim = (value: unknown) => {
  const role = textClaim(value);
  if (!role) return null;
  return role.includes(":") ? role : `org:${role}`;
};

const nameFromClaims = (payload: Record<string, unknown>) => {
  const full = textClaim(payload.name);
  if (full) return full;
  const first = textClaim(payload.first_name) ?? textClaim(payload.firstName);
  const last = textClaim(payload.last_name) ?? textClaim(payload.lastName);
  const joined = [first, last].filter(Boolean).join(" ").trim();
  return joined || null;
};

export const bearerTokenFromHeaders = (headers: Headers) => {
  const authorization = headers.get("authorization");
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  return token.trim() || null;
};

/** Supports both Clerk JWT v2 organization claims and legacy v1 flat claims. */
export const clerkClaimsFromPayload = (payload: Record<string, unknown>): ClerkVerifiedClaims => {
  const userId = textClaim(payload.sub);
  if (!userId) throw new Error("Clerk session token is missing a subject.");

  const organization = recordClaim(payload.o);

  return {
    userId,
    sessionId: textClaim(payload.sid) ?? userId,
    clerkOrganizationId: textClaim(organization?.id) ?? textClaim(payload.org_id),
    organizationRole:
      organizationRoleClaim(organization?.rol) ?? organizationRoleClaim(payload.org_role),
    organizationSlug: textClaim(organization?.slg) ?? textClaim(payload.org_slug),
    email: textClaim(payload.email) ?? textClaim(payload.email_address),
    name: nameFromClaims(payload),
    image: textClaim(payload.image) ?? textClaim(payload.picture),
  };
};

export const verifyClerkBearerToken = async (
  token: string,
  config: ClerkVerifyConfig,
): Promise<ClerkVerifiedClaims> => {
  const payload = (await verifyToken(token, {
    secretKey: config.secretKey,
    ...(config.jwtKey ? { jwtKey: config.jwtKey } : {}),
    ...(config.jwtAudience ? { audience: config.jwtAudience } : {}),
    ...(config.authorizedParties && config.authorizedParties.length > 0
      ? { authorizedParties: [...config.authorizedParties] }
      : {}),
  })) as Record<string, unknown>;

  return clerkClaimsFromPayload(payload);
};

export const makeClerkBackend = (config: Pick<ClerkVerifyConfig, "secretKey">) =>
  createClerkClient({ secretKey: config.secretKey });

export const loadClerkUserProfile = async (
  client: ReturnType<typeof createClerkClient>,
  userId: string,
) => {
  const user = await client.users.getUser(userId);
  const email =
    user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
  const name =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.username ||
    email ||
    "Tabaaq user";
  return {
    email,
    name,
    image: user.imageUrl ?? null,
  };
};

export const loadClerkOrganizationMemberships = async (
  client: ReturnType<typeof createClerkClient>,
  userId: string,
): Promise<ReadonlyArray<ClerkOrganizationMembership>> => {
  const { data } = await client.users.getOrganizationMembershipList({
    userId,
    limit: 100,
  });
  return data.flatMap((membership) => {
    const organization = membership.organization;
    if (!organization?.id) return [];
    return [
      {
        clerkOrganizationId: organization.id,
        name: organization.name,
        slug: organization.slug ?? null,
        role: membership.role,
      },
    ];
  });
};
