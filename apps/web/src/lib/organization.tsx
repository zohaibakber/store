import type {
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
} from "@store/auth";
import * as React from "react";

import { toastManager } from "@/components/ui/toast";
import { authSession } from "@/lib/auth";
import { storeErrorMessage, toastStoreError } from "@/lib/errors";

/**
 * Nothing is emailed yet, so whoever created the invitation delivers it. A
 * browser can hand over a link that opens straight into settings; the desktop
 * build is served from a file URL nobody else can open, so it hands over the
 * bare token and the recipient pastes it.
 */
export const invitationHandoff = (token: string) => {
  const origin = globalThis.location?.origin;
  return origin?.startsWith("http")
    ? { kind: "link" as const, value: `${origin}/settings?invitation=${encodeURIComponent(token)}` }
    : { kind: "token" as const, value: token };
};

export async function copyInvitation(token: string) {
  const handoff = invitationHandoff(token);
  try {
    await navigator.clipboard.writeText(handoff.value);
    toastManager.add({
      description: "Send it to them yourself; it is shown only once.",
      title: handoff.kind === "link" ? "Invite link copied" : "Invite token copied",
      type: "success",
    });
  } catch {
    toastManager.add({ title: "Copying was blocked by this device.", type: "error" });
  }
}

/** A roster and an error are both absent until the first read comes back. */
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

/**
 * A rename or a redeemed invitation changes what the access token says, and
 * the token is what the rest of the app reads the organization from.
 */
const movesTheSession = (result: OrganizationCommandResult) =>
  result._tag === "Updated" || result._tag === "Joined";

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const [roster, setRoster] = React.useState<OrganizationRoster | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(
    () =>
      authSession()
        .organizationRoster()
        .then(
          (next) => {
            setRoster(next);
            setError(null);
          },
          (cause: unknown) =>
            setError(storeErrorMessage(cause, "The organization could not be loaded.")),
        ),
    [],
  );

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const organize = React.useCallback(
    async (command: OrganizationCommand) => {
      try {
        const result = await authSession().organize(command);
        if (movesTheSession(result)) await authSession().renewSession();
        await reload();
        return result;
      } catch (cause) {
        toastStoreError(cause);
        return null;
      }
    },
    [reload],
  );

  const value = React.useMemo(
    () => ({ state: { roster, error }, actions: { reload, organize } }),
    [roster, error, reload, organize],
  );

  return <OrganizationContext value={value}>{children}</OrganizationContext>;
}

export function useOrganization() {
  const value = React.use(OrganizationContext);
  if (!value) throw new Error("useOrganization must be used inside OrganizationProvider");
  return value;
}
