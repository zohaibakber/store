import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { AuthOrganizationMembership, UpdateOrganizationInput } from "@store/auth";
import * as Effect from "effect/Effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as Schema from "effect/Schema";
import * as React from "react";

import { appHost } from "@/host";
import { bridgeMessage, toastBridgeFailure } from "@/lib/errors";

interface OrganizationState {
  readonly organization: AuthOrganizationMembership | null;
  readonly error: string | null;
}

interface OrganizationActions {
  readonly reload: () => Promise<void>;
  readonly update: (input: UpdateOrganizationInput) => Promise<AuthOrganizationMembership | null>;
}

const OrganizationContext = React.createContext<{
  readonly state: OrganizationState;
  readonly actions: OrganizationActions;
} | null>(null);

class OrganizationProviderMissing extends Schema.TaggedError<OrganizationProviderMissing>()(
  "OrganizationProviderMissing",
  {},
) {}

const organizationAtom = Atom.make(
  Effect.tryPromise({
    try: () => appHost().auth.organization(),
    catch: (cause) => bridgeMessage(cause, "Couldn't load the organization."),
  }),
);

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const result = useAtomValue(organizationAtom);
  const refresh = useAtomRefresh(organizationAtom);

  const reload = React.useCallback(async () => {
    refresh();
  }, [refresh]);

  const update = React.useCallback(
    async (input: UpdateOrganizationInput) => {
      try {
        const updated = await appHost().auth.updateOrganization(input);
        await appHost().auth.renewSession();
        refresh();
        return updated;
      } catch (cause) {
        toastBridgeFailure(cause);
        return null;
      }
    },
    [refresh],
  );

  const state: OrganizationState = AsyncResult.matchWithError(result, {
    onInitial: () => ({ organization: null, error: null }),
    onSuccess: (success) => ({ organization: success.value, error: null }),
    onError: (error) => ({ organization: null, error }),
    onDefect: (defect) => ({
      organization: null,
      error: bridgeMessage(defect, "Couldn't load the organization."),
    }),
  });

  const value = React.useMemo(
    () => ({ state, actions: { reload, update } }),
    [state, reload, update],
  );

  return <OrganizationContext value={value}>{children}</OrganizationContext>;
}

export function useOrganization() {
  const value = React.use(OrganizationContext);
  if (!value) throw new OrganizationProviderMissing();
  return value;
}
