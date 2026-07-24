import {
  Menu,
  MenuPopup,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  MoreHorizontalCircle01Icon,
  FolderIcon,
  Share03Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";

export function NavProjects({
  projects,
}: {
  projects: {
    name: string;
    url: string;
    icon: React.ReactNode;
  }[];
}) {
  const { isMobile } = useSidebar();
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Projects</SidebarGroupLabel>
      <SidebarMenu>
        {projects.map((item) => (
          <SidebarMenuItem key={item.name}>
            <SidebarMenuButton render={<a href={item.url} />}>
              {item.icon}
              <span>{item.name}</span>
            </SidebarMenuButton>
            <Menu>
              <MenuTrigger
                render={<SidebarMenuAction showOnHover className="aria-expanded:bg-muted" />}
              >
                <HugeiconsIcon icon={MoreHorizontalCircle01Icon} strokeWidth={2} />
                <span className="sr-only">More</span>
              </MenuTrigger>
              <MenuPopup
                className="w-48"
                side={isMobile ? "bottom" : "right"}
                align={isMobile ? "end" : "start"}
              >
                <MenuGroup>
                  <MenuItem>
                    <HugeiconsIcon
                      icon={FolderIcon}
                      strokeWidth={2}
                      className="text-muted-foreground"
                    />
                    <span>View Project</span>
                  </MenuItem>
                  <MenuItem>
                    <HugeiconsIcon
                      icon={Share03Icon}
                      strokeWidth={2}
                      className="text-muted-foreground"
                    />
                    <span>Share Project</span>
                  </MenuItem>
                </MenuGroup>
                <MenuSeparator />
                <MenuGroup>
                  <MenuItem>
                    <HugeiconsIcon
                      icon={Delete02Icon}
                      strokeWidth={2}
                      className="text-muted-foreground"
                    />
                    <span>Delete Project</span>
                  </MenuItem>
                </MenuGroup>
              </MenuPopup>
            </Menu>
          </SidebarMenuItem>
        ))}
        <SidebarMenuItem>
          <SidebarMenuButton>
            <HugeiconsIcon icon={MoreHorizontalCircle01Icon} strokeWidth={2} />
            <span>More</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
