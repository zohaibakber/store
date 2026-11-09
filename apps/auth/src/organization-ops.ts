import type { AuthOrganizationMembership, UpdateOrganizationInput } from "@store/auth";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";

import { AuthRefusal } from "./failures";
import { AuthRepository, type MembershipRecord } from "./repository";
import { Sessions } from "./session-ops";

const membershipView = (membership: MembershipRecord): AuthOrganizationMembership => ({
  id: membership.organizationId,
  name: membership.organizationName,
  role: membership.role,
});

export class Organizations extends Context.Service<Organizations>()(
  "@store/auth-worker/Organizations",
  {
    make: Effect.gen(function* () {
      const repository = yield* AuthRepository;
      const sessions = yield* Sessions;

      const membershipOf = Effect.fn("Organizations.membershipOf")(function* (
        input: Parameters<typeof repository.membershipInOrganization>[0],
      ) {
        const membership = yield* repository.membershipInOrganization(input);
        if (!membership) {
          return yield* new AuthRefusal({ reason: "OrganizationNotFound" });
        }
        return membership;
      });

      const read = Effect.fn("Organizations.read")(function* (
        accessToken: Redacted.Redacted<string>,
      ) {
        const claims = yield* sessions.authorize(accessToken);
        const membership = yield* membershipOf({
          userId: claims.subject,
          organizationId: claims.activeOrganizationId,
        });
        return membershipView(membership);
      });

      const update = Effect.fn("Organizations.update")(function* (
        accessToken: Redacted.Redacted<string>,
        input: UpdateOrganizationInput,
      ) {
        const claims = yield* sessions.authorize(accessToken);
        const membership = yield* membershipOf({
          userId: claims.subject,
          organizationId: input.organizationId,
        });
        if (membership.role === "member") {
          return yield* new AuthRefusal({ reason: "InsufficientRole" });
        }
        const updated = yield* repository.updateOrganization({
          organizationId: input.organizationId,
          name: input.name,
          role: membership.role,
        });
        if (!updated) {
          return yield* new AuthRefusal({ reason: "OrganizationNotFound" });
        }
        return membershipView(updated);
      });

      return { read, update };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
