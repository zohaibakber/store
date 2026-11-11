import {
  AccessClaims,
  EmailAddress,
  JwtError,
  OrganizationId,
  SessionId,
  UserId,
  type AccessTokenVerifier,
} from "@store/auth";
import { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpEffect from "effect/http/HttpEffect";
import * as Layer from "effect/Layer";

import { AccessTokens } from "../../src/auth/access-tokens";
import { makeWorkerFetch } from "../../src/http/app";
import { OrgAuthorities, OrganizationAuthority } from "../../src/inventory/organization-authority";

const unused = () => Effect.die("unused");

const unusedAuthority: ReturnType<OrgAuthorities["Service"]["getByName"]> = {
  register: unused,
  submit: unused,
  receipt: unused,
  pull: unused,
  acquireSnapshot: unused,
  readSnapshotPart: unused,
  liveHorizon: unused,
  stageImportPart: unused,
  commitImport: unused,
  importStatus: unused,
  maintain: unused,
  fetch: unused,
};

export const TEST_ACCESS_TOKEN = "header.payload.signature";

export const TEST_EPOCH = 1_700_000_000_000;

export const claimsFor = (
  role: "owner" | "admin" | "member",
  organizationId = "org-1",
  expiresAt = TEST_EPOCH + 60_000,
) =>
  AccessClaims.make({
    subject: UserId.make("user-1"),
    sessionId: SessionId.make("session-1"),
    activeOrganizationId: OrganizationId.make(organizationId),
    organizationName: "Tabaaq",
    role,
    email: EmailAddress.make("member@example.com"),
    name: "Member",
    image: null,
    expiresAt,
  });

export const verifierFor =
  (claims: AccessClaims | null): AccessTokenVerifier =>
  (token) =>
    claims !== null && token === TEST_ACCESS_TOKEN
      ? Effect.succeed(claims)
      : Effect.fail(
          new JwtError({ reason: "InvalidSignature", message: "The test token is not accepted." }),
        );

export const testRuntimeContext = Context.make(RuntimeContext, {
  Type: "test",
  id: "server-route-test",
  env: {},
  get: () => Effect.succeed(undefined),
  set: (id) => Effect.succeed(id),
});

export interface AppOptions {
  readonly claims?: AccessClaims;
  readonly authorities?: OrgAuthorities["Service"];
}

const servicesFor = (options: AppOptions) =>
  Layer.mergeAll(
    OrganizationAuthority.layer.pipe(
      Layer.provideMerge(
        Layer.succeed(OrgAuthorities, options.authorities ?? { getByName: () => unusedAuthority }),
      ),
    ),
    Layer.succeed(AccessTokens, {
      verify: verifierFor(options.claims ?? claimsFor("owner")),
    }),
  );

export const webHandlerFor = (options: AppOptions = {}) =>
  makeWorkerFetch.pipe(
    Effect.provide(servicesFor(options)),
    Effect.map((fetch) =>
      HttpEffect.toWebHandler(fetch.pipe(Effect.provideContext(testRuntimeContext))),
    ),
    Effect.provideContext(testRuntimeContext),
  );
