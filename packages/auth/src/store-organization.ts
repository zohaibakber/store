/**
 * Durable Object instances are named with `getByName(storeOrganizationId)`.
 * That id used to be the Better Auth organization id. Clerk organization ids
 * are different, so a binding table keeps existing sqlite (cloud and local)
 * attached to the same name.
 */
export interface OrganizationBinding {
  readonly clerkOrganizationId: string;
  readonly storeOrganizationId: string;
}

export interface LegacyStoreOrganization {
  readonly storeOrganizationId: string;
  readonly name: string;
  readonly slug: string;
  readonly role: string;
}

export interface OrganizationBindingStore {
  readonly getByClerkOrganizationId: (
    clerkOrganizationId: string,
  ) => Promise<OrganizationBinding | null>;
  readonly getByStoreOrganizationId: (
    storeOrganizationId: string,
  ) => Promise<OrganizationBinding | null>;
  readonly findLegacyStoreOrganizationByEmail: (
    email: string,
  ) => Promise<LegacyStoreOrganization | null>;
  readonly putBinding: (input: {
    readonly clerkOrganizationId: string;
    readonly storeOrganizationId: string;
    readonly clerkUserId: string;
    readonly email: string;
  }) => Promise<void>;
}

export type StoreOrganizationBindingSource = "existing" | "legacy" | "new";

export interface ResolvedStoreOrganization {
  readonly clerkOrganizationId: string;
  readonly storeOrganizationId: string;
  readonly source: StoreOrganizationBindingSource;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const resolveStoreOrganizationId = async (
  store: OrganizationBindingStore,
  input: {
    readonly clerkOrganizationId: string;
    readonly clerkUserId: string;
    readonly email: string;
  },
): Promise<ResolvedStoreOrganization> => {
  const existing = await store.getByClerkOrganizationId(input.clerkOrganizationId);
  if (existing) {
    return {
      clerkOrganizationId: existing.clerkOrganizationId,
      storeOrganizationId: existing.storeOrganizationId,
      source: "existing",
    };
  }

  const email = normalizeEmail(input.email);
  const legacy = email ? await store.findLegacyStoreOrganizationByEmail(email) : null;
  const claimed = legacy ? await store.getByStoreOrganizationId(legacy.storeOrganizationId) : null;
  const bind = async (storeOrganizationId: string, source: StoreOrganizationBindingSource) => {
    await store.putBinding({
      clerkOrganizationId: input.clerkOrganizationId,
      storeOrganizationId,
      clerkUserId: input.clerkUserId,
      email: email || input.email,
    });
    return {
      clerkOrganizationId: input.clerkOrganizationId,
      storeOrganizationId,
      source,
    } satisfies ResolvedStoreOrganization;
  };

  if (legacy && !claimed) {
    try {
      return await bind(legacy.storeOrganizationId, "legacy");
    } catch {
      const raced = await store.getByClerkOrganizationId(input.clerkOrganizationId);
      if (raced) {
        return {
          clerkOrganizationId: raced.clerkOrganizationId,
          storeOrganizationId: raced.storeOrganizationId,
          source: "existing",
        };
      }
    }
  }

  return bind(input.clerkOrganizationId, "new");
};

export const mapClerkOrganizationRole = (role: string | undefined) => {
  const normalized = (role ?? "org:member").replace(/^org:/, "");
  if (normalized === "admin") return "owner";
  return normalized || "member";
};
