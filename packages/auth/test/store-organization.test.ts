import { describe, expect, it } from "vitest";

import {
  mapClerkOrganizationRole,
  resolveStoreOrganizationId,
  type OrganizationBinding,
  type OrganizationBindingStore,
} from "../src/store-organization";

const memoryStore = () => {
  const byClerk = new Map<string, OrganizationBinding>();
  const byStore = new Map<string, OrganizationBinding>();
  let legacy: { storeOrganizationId: string; name: string; slug: string; role: string } | null =
    null;

  const commitBinding: OrganizationBindingStore["putBinding"] = async (input) => {
    const binding = {
      clerkOrganizationId: input.clerkOrganizationId,
      storeOrganizationId: input.storeOrganizationId,
    };
    byClerk.set(input.clerkOrganizationId, binding);
    byStore.set(input.storeOrganizationId, binding);
  };
  let putBinding = commitBinding;

  const store: OrganizationBindingStore = {
    getByClerkOrganizationId: async (id) => byClerk.get(id) ?? null,
    getByStoreOrganizationId: async (id) => byStore.get(id) ?? null,
    findLegacyStoreOrganizationByEmail: async () => legacy,
    putBinding: (input) => putBinding(input),
  };

  return {
    store,
    commitBinding,
    setLegacy: (value: typeof legacy) => {
      legacy = value;
    },
    setPutBinding: (next: OrganizationBindingStore["putBinding"]) => {
      putBinding = next;
    },
  };
};

describe("resolveStoreOrganizationId", () => {
  it("reuses an existing Clerk-to-store binding", async () => {
    const { store } = memoryStore();
    await store.putBinding({
      clerkOrganizationId: "org_clerk",
      storeOrganizationId: "org_legacy",
      clerkUserId: "user_1",
      email: "owner@example.com",
    });

    await expect(
      resolveStoreOrganizationId(store, {
        clerkOrganizationId: "org_clerk",
        clerkUserId: "user_1",
        email: "owner@example.com",
      }),
    ).resolves.toEqual({
      clerkOrganizationId: "org_clerk",
      storeOrganizationId: "org_legacy",
      source: "existing",
    });
  });

  it("binds the first Clerk org for an email to the Better Auth organization id", async () => {
    const { store, setLegacy } = memoryStore();
    setLegacy({
      storeOrganizationId: "org_better_auth",
      name: "Tabaaq",
      slug: "tabaaq",
      role: "owner",
    });

    await expect(
      resolveStoreOrganizationId(store, {
        clerkOrganizationId: "org_clerk_1",
        clerkUserId: "user_1",
        email: "Owner@example.com",
      }),
    ).resolves.toEqual({
      clerkOrganizationId: "org_clerk_1",
      storeOrganizationId: "org_better_auth",
      source: "legacy",
    });
  });

  it("does not attach a second Clerk org to a store id that is already bound", async () => {
    const { store, setLegacy } = memoryStore();
    setLegacy({
      storeOrganizationId: "org_better_auth",
      name: "Tabaaq",
      slug: "tabaaq",
      role: "owner",
    });
    await resolveStoreOrganizationId(store, {
      clerkOrganizationId: "org_clerk_1",
      clerkUserId: "user_1",
      email: "owner@example.com",
    });

    await expect(
      resolveStoreOrganizationId(store, {
        clerkOrganizationId: "org_clerk_2",
        clerkUserId: "user_1",
        email: "owner@example.com",
      }),
    ).resolves.toEqual({
      clerkOrganizationId: "org_clerk_2",
      storeOrganizationId: "org_clerk_2",
      source: "new",
    });
  });

  it("uses the Clerk organization id when there is no legacy inventory", async () => {
    const { store } = memoryStore();
    await expect(
      resolveStoreOrganizationId(store, {
        clerkOrganizationId: "org_new",
        clerkUserId: "user_2",
        email: "new@example.com",
      }),
    ).resolves.toEqual({
      clerkOrganizationId: "org_new",
      storeOrganizationId: "org_new",
      source: "new",
    });
  });

  it("falls back to the Clerk org id if the legacy store id is claimed during insert", async () => {
    const { store, setLegacy, setPutBinding, commitBinding } = memoryStore();
    setLegacy({
      storeOrganizationId: "org_better_auth",
      name: "Tabaaq",
      slug: "tabaaq",
      role: "owner",
    });
    setPutBinding(async (input) => {
      if (input.storeOrganizationId === "org_better_auth") {
        throw new Error("UNIQUE constraint failed: clerk_org_binding.storeOrganizationId");
      }
      return commitBinding(input);
    });

    await expect(
      resolveStoreOrganizationId(store, {
        clerkOrganizationId: "org_clerk_race",
        clerkUserId: "user_1",
        email: "owner@example.com",
      }),
    ).resolves.toEqual({
      clerkOrganizationId: "org_clerk_race",
      storeOrganizationId: "org_clerk_race",
      source: "new",
    });
  });
});

describe("mapClerkOrganizationRole", () => {
  it("maps Clerk admin to the desktop owner role", () => {
    expect(mapClerkOrganizationRole("org:admin")).toBe("owner");
    expect(mapClerkOrganizationRole("org:member")).toBe("member");
    expect(mapClerkOrganizationRole(undefined)).toBe("member");
  });
});
