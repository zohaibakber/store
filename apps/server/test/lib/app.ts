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
import * as HttpEffect from "effect/unstable/http/HttpEffect";

import { makeWorkerFetch, type WorkerServices } from "../../src/http/app";
import type { ServerRuntimeContract } from "../../src/http/runtime";

const unused = () => Effect.die("unused");

const unusedInventory = {
  commands: { register: unused, submitRaw: unused, receipt: unused, pullEncoded: unused },
  snapshots: { acquireSnapshot: unused, readSnapshotPartEncoded: unused },
  imports: { stagePart: unused, commit: unused },
  devices: { list: unused, command: unused },
} satisfies Pick<WorkerServices, "commands" | "snapshots" | "imports" | "devices">;

export const TEST_ACCESS_TOKEN = "header.payload.signature";

export const claimsFor = (
  role: "owner" | "admin" | "member",
  organizationId = "org-1",
  expiresAt = Date.now() + 60_000,
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

export interface AppOptions extends Partial<Omit<WorkerServices, "runtime">> {
  readonly claims?: AccessClaims;
}

const runtimeFor = (options: AppOptions): ServerRuntimeContract => ({
  trustedOrigins: ["http://localhost:5173", "http://localhost:5174"],
  verifyAccessToken: verifierFor(options.claims ?? claimsFor("owner")),
  invoiceAi: Effect.succeed({ toMarkdown: unused, generate: unused }),
  limitInvoiceExtraction: unused,
  productScanAi: Effect.succeed({ generate: unused }),
  limitProductScan: unused,
});

export const webHandlerFor = async (options: AppOptions = {}) => {
  const fetch = await Effect.runPromise(
    makeWorkerFetch({
      runtime: runtimeFor(options),
      commands: options.commands ?? unusedInventory.commands,
      snapshots: options.snapshots ?? unusedInventory.snapshots,
      imports: options.imports ?? unusedInventory.imports,
      devices: options.devices ?? unusedInventory.devices,
      liveFanout: options.liveFanout ?? { publish: () => Effect.void },
      hubs: options.hubs ?? { getByName: () => ({ fetch: unused }) },
      readLiveHorizon: options.readLiveHorizon ?? unused,
    }).pipe(Effect.provideContext(testRuntimeContext)),
  );
  return HttpEffect.toWebHandler(fetch.pipe(Effect.provideContext(testRuntimeContext)));
};
