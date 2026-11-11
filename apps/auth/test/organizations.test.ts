import { describe, expect, it } from "@effect/vitest";
import { OrganizationName, type AccessToken, type OrganizationId } from "@store/auth";
import * as Effect from "effect/Effect";

import { AuthApi, AuthTest, count, refusal, scenario, signUp } from "./harness";

const rename = (accessToken: AccessToken, organizationId: OrganizationId) =>
  refusal(
    AuthApi.use((auth) =>
      auth.updateOrganization(accessToken, {
        organizationId,
        name: OrganizationName.make("Renamed"),
      }),
    ),
  );

const renamed = (organizationId: OrganizationId) =>
  count(
    "SELECT count(*) AS total FROM auth_organization WHERE id = ? AND name = 'Renamed'",
    organizationId,
  );

describe("organization isolation", () => {
  it.effect("refuses a rename from a plain member", () =>
    Effect.gen(function* () {
      const owner = yield* signUp("owner@example.com");
      const member = yield* signUp("member@example.com");
      const organizationId = owner.workspace.activeOrganization.id;
      const control = yield* AuthTest;
      control.d1.database
        .prepare(
          "INSERT INTO auth_organization_membership (id, organizationId, userId, role) VALUES (?, ?, ?, 'member')",
        )
        .run("membership-member", organizationId, member.workspace.user.id);

      const failure = yield* rename(member.accessToken, organizationId);

      expect(failure).toMatchObject({ status: 403, code: "INSUFFICIENT_ROLE" });
      expect(yield* renamed(organizationId)).toBe(0);
    }).pipe(scenario()),
  );

  it.effect("hides an organization the caller does not belong to", () =>
    Effect.gen(function* () {
      const owner = yield* signUp("owner@example.com");
      const outsider = yield* signUp("outsider@example.com");
      const organizationId = owner.workspace.activeOrganization.id;

      const failure = yield* rename(outsider.accessToken, organizationId);

      expect(failure).toMatchObject({ status: 404, code: "ORGANIZATION_NOT_FOUND" });
      expect(yield* renamed(organizationId)).toBe(0);
    }).pipe(scenario()),
  );
});
