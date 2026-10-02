import { bearerTokenFromHeaders, type AccessClaims, type AccessTokenVerifier } from "@store/auth";
import {
  decodeOrganizationId,
  decodeUserId,
  unauthenticatedWorkspace,
  WorkspaceSnapshot,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";

export const authenticateToken = (
  verify: AccessTokenVerifier,
  token: string | null | undefined,
): Effect.Effect<AccessClaims | null> =>
  token
    ? verify(token).pipe(
        Effect.tapError((error) =>
          Effect.logWarning("Access token verification failed").pipe(
            Effect.annotateLogs({ cause: error.message }),
          ),
        ),
        Effect.orElseSucceed(() => null),
      )
    : Effect.succeed(null);

export const authenticateRequest = (
  verify: AccessTokenVerifier,
  request: HttpServerRequest.HttpServerRequest,
) => authenticateToken(verify, bearerTokenFromHeaders(new Headers(request.headers)));

export const workspaceSnapshotOf = (claims: AccessClaims | null): WorkspaceSnapshot => {
  if (claims === null) return unauthenticatedWorkspace({ isOnline: true });
  const organization = {
    id: decodeOrganizationId(claims.activeOrganizationId),
    name: claims.organizationName,
    role: claims.role,
  };
  return WorkspaceSnapshot.make({
    status: "authenticated",
    user: {
      id: decodeUserId(claims.subject),
      name: claims.name,
      email: claims.email,
      image: claims.image,
    },
    activeOrganization: organization,
    organizations: [organization],
    isOnline: true,
  });
};
