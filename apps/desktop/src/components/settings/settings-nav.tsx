import { Link, useRouterState } from "@tanstack/react-router";

import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";

const sections = [
  { to: "/settings/account", label: "Account" },
  { to: "/settings/organization", label: "Organization" },
  { to: "/settings/appearance", label: "Appearance" },
  { to: "/settings/about", label: "About" },
] as const;

export function SettingsNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const active = sections.find((section) => pathname.startsWith(section.to))?.to ?? null;

  return (
    <Tabs value={active}>
      <TabsList aria-label="Settings sections">
        {sections.map((section) => (
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
