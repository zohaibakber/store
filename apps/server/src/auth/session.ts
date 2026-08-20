import {
  AuthSession,
  bearerTokenFromHeaders,
  verifyAccessToken,
  type JwtConfiguration,
} from "@store/auth";
import { unauthenticatedWorkspace, WorkspaceSnapshot } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("Server.AuthError", {
  message: Schema.String,
}) {}

export type AuthVerificationConfig = Pick<
  JwtConfiguration,
  "issuer" | "audience" | "publicJwk"
>;

export const authenticateHeaders = (
  headers: Headers,
  config: AuthVerificationConfig,
): Effect.Effect<typeof AuthSession.Type | null, AuthError> =>
  Effect.gen(function* () {
    const token = bearerTokenFromHeaders(headers);
    if (!token) return null;
    const claims = yield* verifyAccessToken(token, config).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("Access token verification failed").pipe(
          Effect.annotateLogs({ cause: error.message }),
        ),
      ),
      Effect.mapError(() => new AuthError({ message: "The access token is invalid." })),
      Effect.option,
    );
    if (claims._tag === "None") return null;
    const verified = claims.value;
    return AuthSession.make({
      user: {
        id: verified.subject,
        name: verified.name,
        email: verified.email,
        image: verified.image,
      },
      session: {
        id: verified.sessionId,
        userId: verified.subject,
        activeOrganizationId: verified.activeOrganizationId,
        expiresAt: verified.expiresAt,
      },
      organizations: [
        {
          id: verified.activeOrganizationId,
          name: verified.organizationName,
          slug: verified.organizationSlug,
          role: verified.role,
        },
      ],
    });
  });

export const loadWorkspaceSnapshot = (
  headers: Headers,
  config: AuthVerificationConfig,
): Effect.Effect<typeof WorkspaceSnapshot.Type, AuthError> =>
  Effect.gen(function* () {
    const session = yield* authenticateHeaders(headers, config);
    if (!session) return unauthenticatedWorkspace({ isOnline: true });
    const activeOrganization = session.organizations[0] ?? null;
    return WorkspaceSnapshot.make({
      status: "authenticated",
      user: session.user,
      activeOrganization,
      organizations: [...session.organizations],
      isOnline: true,
    });
  });
