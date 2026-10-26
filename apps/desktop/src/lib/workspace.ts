import { useAtomSet } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";

import type { OpenWorkspace, Workspace } from "@/host-access";
import { useAuth } from "@/lib/auth";
import { toastBridgeFailure } from "@/lib/errors";
import type { DeviceWorkspace } from "@/session/device-workspace";
import { selectWorkspace } from "@/session/workspace-session";

export const workspaceName = (workspace: Workspace): string => {
  switch (workspace._tag) {
    case "None":
      return "Tabaaq";
    case "Local":
      return "This device";
    case "Organization":
      return workspace.organization.name;
  }
};

export const workspaceKey = (workspace: OpenWorkspace): DeviceWorkspace["active"] => {
  switch (workspace._tag) {
    case "Local":
      return "local";
    case "Organization":
      return "organization";
  }
};

export const workspaceStorageKey = (workspace: Workspace): string => {
  switch (workspace._tag) {
    case "None":
      return "none";
    case "Local":
      return "local";
    case "Organization":
      return `organization.${workspace.organization.id}`;
  }
};

export const useWorkspaceStorageKey = () => workspaceStorageKey(useAuth().workspace);

export const useOpenWorkspace = () => {
  const navigate = useNavigate();
  const select = useAtomSet(selectWorkspace, { mode: "promise" });
  return (active: DeviceWorkspace["active"]) => {
    void select(active).catch((cause: unknown) => toastBridgeFailure(cause));
    void navigate({ to: "/", replace: true });
  };
};
