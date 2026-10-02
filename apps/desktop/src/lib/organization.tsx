import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type {
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
} from "@store/auth";
import { useSearch } from "@tanstack/react-router";
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as React from "react";

import { toastManager } from "@/components/ui/toast";
import { authSession } from "@/lib/auth";
import { storeErrorMessage, toastStoreError } from "@/lib/errors";

const originOpensInviteLinks = (origin: string | undefined) => Boolean(origin?.startsWith("http"));

export const invitationHandoff = (token: string) => {
  const origin = globalThis.location?.origin;
  return originOpensInviteLinks(origin)
    ? {
        kind: "link" as const,
        value: `${origin}/settings?invitation=${encodeURIComponent(token)}`,
      }
    : { kind: "token" as const, value: token };
};

const LinkedInvitation = Schema.Struct({
  invitation: Schema.optionalKey(Schema.String),
});

export const useLinkedInvitation = () => {
  const search = useSearch({ strict: false });
  const decoded = Schema.decodeUnknownOption(LinkedInvitation)(search);
  return decoded._tag === "Some" ? (decoded.value.invitation ?? "") : "";
};

export async function copyInvitation(token: string) {
  const handoff = invitationHandoff(token);
  try {
    await navigator.clipboard.writeText(handoff.value);
    toastManager.add({
      description: "Send it yourself. You'll only see it once.",
      title: handoff.kind === "link" ? "Invite link copied" : "Invite token copied",
      type: "success",
    });
  } catch {
    toastManager.add({ title: "Copying was blocked by this device.", type: "error" });
  }
}

interface OrganizationState {
  readonly roster: OrganizationRoster | null;
  readonly error: string | null;
}

interface OrganizationActions {
  readonly reload: () => Promise<void>;
  readonly organize: (command: OrganizationCommand) => Promise<OrganizationCommandResult | null>;
}

const OrganizationContext = React.createContext<{
  readonly state: OrganizationState;
  readonly actions: OrganizationActions;
} | null>(null);

const rewritesAccessToken = (result: OrganizationCommandResult) =>
  result._tag === "Updated" || result._tag === "Joined";

const organizationRosterAtom = Atom.make(
  Effect.tryPromise({
    try: () => authSession().organizationRoster(),
    catch: (cause) => storeErrorMessage(cause, "Couldn't load the organization."),
  }),
);

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const result = useAtomValue(organizationRosterAtom);
  const refresh = useAtomRefresh(organizationRosterAtom);

  const reload = React.useCallback(async () => {
    refresh();
  }, [refresh]);

  const organize = React.useCallback(
    async (command: OrganizationCommand) => {
      try {
        const commandResult = await authSession().organize(command);
        if (rewritesAccessToken(commandResult)) await authSession().renewSession();
        refresh();
        return commandResult;
      } catch (cause) {
        toastStoreError(cause);
        return null;
      }
    },
    [refresh],
  );

  const state: OrganizationState = AsyncResult.matchWithError(result, {
    onInitial: () => ({ roster: null, error: null }),
    onSuccess: (success) => ({ roster: success.value, error: null }),
    onError: (error) => ({ roster: null, error }),
    onDefect: (defect) => ({
      roster: null,
      error: storeErrorMessage(defect, "Couldn't load the organization."),
    }),
  });

  const value = React.useMemo(
    () => ({ state, actions: { reload, organize } }),
    [state, reload, organize],
  );

  return <OrganizationContext value={value}>{children}</OrganizationContext>;
}

export function useOrganization() {
  const value = React.use(OrganizationContext);
  if (!value) throw new Error("useOrganization must be used inside OrganizationProvider");
  return value;
}
