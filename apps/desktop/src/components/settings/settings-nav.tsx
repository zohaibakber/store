import { Link, useRouterState } from "@tanstack/react-router";

import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { appHost } from "@/host";

const sections = [
  { to: "/settings/account", label: "Account" },
  { to: "/settings/organization", label: "Organization" },
  { to: "/settings/appearance", label: "Appearance" },
  { to: "/settings/backup", label: "Backup" },
  { to: "/settings/about", label: "About" },
] as const;

export function SettingsNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const active = sections.find((section) => pathname.startsWith(section.to))?.to ?? null;
  const visible = sections.filter(
    (section) => section.to !== "/settings/backup" || appHost().backup !== undefined,
  );

  return (
    <Tabs value={active}>
      <TabsList aria-label="Settings sections">
        {visible.map((section) => (
          <TabsTab
            key={section.to}
            nativeButton={false}
            render={<Link to={section.to} />}
            value={section.to}
          >
            {section.label}
          </TabsTab>
        ))}
      </TabsList>
    </Tabs>
  );
}
