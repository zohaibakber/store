import { Building03Icon, ComputerIcon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "@/components/ui/menu";
import type { OpenWorkspace } from "@/host-access";
import { useAuth } from "@/lib/auth";
import { usePublishInProgress } from "@/lib/local-publish";
import { cn } from "@/lib/utils";
import { useOpenWorkspace, workspaceKey, workspaceName } from "@/lib/workspace";

const workspaceIcon = (workspace: OpenWorkspace) => {
  switch (workspace._tag) {
    case "Local":
      return ComputerIcon;
    case "Organization":
      return Building03Icon;
  }
};

function WorkspaceMark({
  name,
  className,
}: {
  readonly name: string;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-2 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0",
        className,
      )}
    >
      <BrandMark alt="" className="size-6 shrink-0 rounded-sm" />
      <span className="truncate font-medium group-data-[collapsible=icon]:hidden">{name}</span>
    </span>
  );
}

function WorkspaceSwitcher({
  current,
  workspaces,
}: {
  readonly current: OpenWorkspace;
  readonly workspaces: ReadonlyArray<OpenWorkspace>;
}) {
  const openWorkspace = useOpenWorkspace();
  const moving = usePublishInProgress();
  return (
    <Menu>
      <MenuTrigger
        disabled={moving}
        render={
          <Button
            aria-label={`Workspace: ${workspaceName(current)}. Switch workspace`}
            className="-ms-2 min-w-0 shrink justify-start group-data-[collapsible=icon]:ms-0 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center"
            size="sm"
            variant="ghost"
          />
        }
      >
        <WorkspaceMark name={workspaceName(current)} />
        <HugeiconsIcon
          aria-hidden="true"
          className="group-data-[collapsible=icon]:hidden"
          icon={UnfoldMoreIcon}
        />
      </MenuTrigger>
      <MenuPopup align="start" className="w-56">
        <MenuGroup>
          <MenuGroupLabel>Workspace</MenuGroupLabel>
          <MenuRadioGroup
            aria-label="Workspace"
            onValueChange={(value) => {
              if (value === "local" || value === "organization") openWorkspace(value);
            }}
            value={workspaceKey(current)}
          >
            {workspaces.map((workspace) => (
              <MenuRadioItem key={workspaceKey(workspace)} value={workspaceKey(workspace)}>
                <span className="flex min-w-0 items-center gap-2">
                  <HugeiconsIcon aria-hidden="true" icon={workspaceIcon(workspace)} />
                  <span className="truncate">{workspaceName(workspace)}</span>
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

export function WorkspaceLogo({ className }: { className?: string }) {
  const { workspace, workspaces } = useAuth();
  if (workspace._tag === "None" || workspaces.length < 2) {
    return <WorkspaceMark className={className} name={workspaceName(workspace)} />;
  }
  return <WorkspaceSwitcher current={workspace} workspaces={workspaces} />;
}
