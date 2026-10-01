import { decodeAuthenticatedWorkspace } from "@store/contracts";
import { describe, expect, it } from "vitest";

import { hostAccess } from "../src/host-access";
import { standingFromRowCount } from "../src/lib/local-catalog-standing";
import { deviceWorkspaceAfter } from "../src/session/device-workspace";

const authenticated = decodeAuthenticatedWorkspace({
  status: "authenticated",
  isOnline: true,
  user: { id: "u1", name: "A", email: "a@b.c", image: null },
  activeOrganization: { id: "o1", name: "Org", slug: "org", role: "owner" },
  organizations: [{ id: "o1", name: "Org", slug: "org", role: "owner" }],
});

describe("standing from replica rows", () => {
  it("treats a replica with rows as something to move", () => {
    expect(standingFromRowCount(0)).toBe("empty");
    expect(standingFromRowCount(4)).toBe("stocked");
  });

  it("lists this device after sign-in when the file has rows and no stored record", () => {
    const signedIn = deviceWorkspaceAfter(null, {
      _tag: "Session",
      organization: true,
      signedIn: true,
    });
    const witnessed = deviceWorkspaceAfter(signedIn, {
      _tag: "LocalCatalog",
      state: standingFromRowCount(4),
    });
    const access = hostAccess({ localWorkspace: { current: () => witnessed } });
    expect(access.workspaces(authenticated).map((choice) => choice._tag)).toEqual([
      "Organization",
      "Local",
    ]);
  });

  it("hides this device when the replica file has no rows", () => {
    const witnessed = deviceWorkspaceAfter(
      { active: "organization", localCatalog: "stocked" },
      { _tag: "LocalCatalog", state: standingFromRowCount(0) },
    );
    const access = hostAccess({ localWorkspace: { current: () => witnessed } });
    expect(access.workspaces(authenticated).map((choice) => choice._tag)).toEqual(["Organization"]);
  });
});
