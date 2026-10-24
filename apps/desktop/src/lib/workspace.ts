import { useNavigate } from "@tanstack/react-router";

import type { OpenWorkspace, Workspace } from "@/host-access";
import { useAuth } from "@/lib/auth";
import { toastStoreError } from "@/lib/errors";
import type { DeviceWorkspace } from "@/session/device-workspace";
import { selectBoundWorkspace } from "@/session/workspace-session";

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
  return (active: DeviceWorkspace["active"]) => {
    void selectBoundWorkspace(active).catch(toastStoreError);
    void navigate({ to: "/", replace: true });
  };
};
