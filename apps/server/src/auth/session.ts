import {
  bearerTokenFromHeaders,
  loadClerkOrganizationMemberships,
  loadClerkUserProfile,
  makeClerkBackend,
  mapClerkOrganizationRole,
  resolveStoreOrganizationId,
  verifyClerkBearerToken,
  type AuthOrganizationMembership,
  type AuthSession,
  type ClerkVerifyConfig,
} from "@store/auth";
import { matchesTrustedOrigin } from "@store/auth/security";
import { unauthenticatedWorkspace, WorkspaceSnapshot } from "@store/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { makeD1BindingStore } from "./bindings";

export class AuthError extends Data.TaggedError("AuthError")<{
  readonly message: string;
}> {}

export interface ClerkAuthServices {
  readonly config: ClerkVerifyConfig;
  readonly database: D1Database;
}

const authFailure = (message: string) => new AuthError({ message });

/**
 * Clerk's browser session JWTs carry an `azp` claim, while Electron and other
 * native session JWTs do not. The native renderer proves its expected app
 * origin through the privileged header added by the main process, so only
 * disable Clerk's `azp` check for a configured native origin.
 */
export const clerkVerifyConfigForHeaders = (
  headers: Headers,
  config: ClerkVerifyConfig,
): ClerkVerifyConfig => {
  const origin = headers.get("origin");
  const nativeOrigin = headers.get("electron-origin") ?? headers.get("expo-origin");
  if (
    !nativeOrigin ||
    (origin !== null && origin !== "null" && origin !== nativeOrigin) ||
    !config.authorizedParties?.some((party) => matchesTrustedOrigin(nativeOrigin, party))
  )
    return config;
  return { ...config, authorizedParties: undefined };
};

const profileFromClaims = async (
  config: ClerkVerifyConfig,
  claims: Awaited<ReturnType<typeof verifyClerkBearerToken>>,
) => {
  if (claims.email && claims.name) {
    return { email: claims.email, name: claims.name, image: claims.image };
  }
  const client = makeClerkBackend(config);
  const profile = await loadClerkUserProfile(client, claims.userId);
  return {
    email: claims.email ?? profile.email ?? "",
    name: claims.name ?? profile.name,
    image: claims.image ?? profile.image,
  };
};

const resolveMembership = (
  database: D1Database,
  input: {
    readonly clerkOrganizationId: string;
    readonly clerkUserId: string;
    readonly email: string;
    readonly name: string;
    readonly slug: string | null;
    readonly role: string;
  },
) =>
  resolveStoreOrganizationId(makeD1BindingStore(database), {
    clerkOrganizationId: input.clerkOrganizationId,
    clerkUserId: input.clerkUserId,
    email: input.email,
  }).then((resolved): AuthOrganizationMembership => ({
    id: resolved.storeOrganizationId,
    clerkOrganizationId: resolved.clerkOrganizationId,
    name: input.name,
    slug: input.slug,
    role: mapClerkOrganizationRole(input.role),
  }));

export const authenticateHeaders = (
  headers: Headers,
  services: ClerkAuthServices,
): Effect.Effect<AuthSession | null, AuthError> =>
  Effect.gen(function* () {
    const token = bearerTokenFromHeaders(headers);
    if (!token) return null;

    const claims = yield* Effect.tryPromise({
      try: () =>
        verifyClerkBearerToken(token, clerkVerifyConfigForHeaders(headers, services.config)),
      catch: (cause) =>
        authFailure(cause instanceof Error ? cause.message : "Clerk session token is invalid."),
    }).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("Clerk token verification failed").pipe(
          Effect.annotateLogs({ cause: error.message }),
        ),
      ),
      Effect.orElseSucceed(() => null),
    );
    if (!claims) return null;

    const profile = yield* Effect.tryPromise({
      try: () => profileFromClaims(services.config, claims),
      catch: (cause) =>
        authFailure(cause instanceof Error ? cause.message : "Clerk user lookup failed."),
    });

    const clerkOrganizationId = claims.clerkOrganizationId;
    const active = clerkOrganizationId
      ? yield* Effect.tryPromise({
          try: () =>
            resolveMembership(services.database, {
              clerkOrganizationId,
              clerkUserId: claims.userId,
              email: profile.email,
              name: profile.name,
              slug: claims.organizationSlug,
              role: claims.organizationRole ?? "org:member",
            }),
          catch: (cause) =>
            authFailure(
              cause instanceof Error ? cause.message : "Organization binding lookup failed.",
            ),
        })
      : null;

    return {
      user: {
        id: claims.userId,
        name: profile.name,
        email: profile.email,
        image: profile.image,
      },
      session: {
        id: claims.sessionId,
        userId: claims.userId,
        activeOrganizationId: active?.id ?? null,
        clerkOrganizationId: claims.clerkOrganizationId,
        expiresAt: claims.expiresAt,
      },
      organizations: active ? [active] : [],
    } satisfies AuthSession;
  });

export const loadWorkspaceSnapshot = (
  headers: Headers,
  services: ClerkAuthServices,
): Effect.Effect<WorkspaceSnapshot, AuthError> =>
  Effect.gen(function* () {
    const session = yield* authenticateHeaders(headers, services);
    if (!session) {
      return unauthenticatedWorkspace({ isOnline: true });
    }

    const memberships = yield* Effect.tryPromise({
      try: async () => {
        const client = makeClerkBackend(services.config);
        const listed = await loadClerkOrganizationMemberships(client, session.user.id);
        const resolved = await Promise.all(
          listed.map((membership) =>
            resolveMembership(services.database, {
              clerkOrganizationId: membership.clerkOrganizationId,
              clerkUserId: session.user.id,
              email: session.user.email,
              name: membership.name,
              slug: membership.slug,
              role: membership.role,
            }),
          ),
        );
        return resolved;
      },
      catch: (cause) =>
        authFailure(cause instanceof Error ? cause.message : "Clerk organization lookup failed."),
    });

    const listed = memberships.map((organization) => ({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: organization.role,
      clerkOrganizationId: organization.clerkOrganizationId,
    }));
    const organizations = [...listed];
    for (const organization of session.organizations) {
      if (!organizations.some((entry) => entry.id === organization.id)) {
        organizations.push({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          role: organization.role,
          clerkOrganizationId: organization.clerkOrganizationId,
        });
      }
    }
    const activeOrganization = session.session.activeOrganizationId
      ? (organizations.find(
          (organization) => organization.id === session.session.activeOrganizationId,
        ) ?? null)
      : null;

    return Schema.decodeUnknownSync(WorkspaceSnapshot)({
      status: "authenticated",
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      },
      activeOrganization: activeOrganization
        ? {
            id: activeOrganization.id,
            name: activeOrganization.name,
            slug: activeOrganization.slug,
            role: activeOrganization.role,
            clerkOrganizationId: activeOrganization.clerkOrganizationId,
          }
        : null,
      organizations,
      isOnline: true,
    });
  });
