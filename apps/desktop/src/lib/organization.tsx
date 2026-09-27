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

/**
 * Invites are not emailed yet. Whoever creates one has to deliver it.
 * On the web we copy a link that opens organization settings. The desktop app
 * runs from a file URL outsiders can't open, so we copy the bare token and
 * the recipient pastes it.
 */
export const invitationHandoff = (token: string) => {
  const origin = globalThis.location?.origin;
  return origin?.startsWith("http")
    ? {
        kind: "link" as const,
        value: `${origin}/settings/organization?invitation=${encodeURIComponent(token)}`,
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
  /**
   * Runs a command and reports what came back, or `null` when it failed and
   * the caller has already been told through a toast.
   */
  readonly organize: (command: OrganizationCommand) => Promise<OrganizationCommandResult | null>;
}

const OrganizationContext = React.createContext<{
  readonly state: OrganizationState;
  readonly actions: OrganizationActions;
} | null>(null);

/** Rename and join rewrite the access token; the rest of the app reads org from that. */
const movesTheSession = (result: OrganizationCommandResult) =>
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
        if (movesTheSession(commandResult)) await authSession().renewSession();
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
