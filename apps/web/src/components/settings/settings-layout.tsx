import {
  Building03Icon,
  Database01Icon,
  Invoice03Icon,
  Settings01Icon,
  UserCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Link, Outlet, useParams } from "@tanstack/react-router";

import {
  availableSettingsSections,
  settingsSectionTitle,
  type SettingsSection,
} from "@/components/settings/sections";
import { PageLayout } from "@/components/shared/page-layout";
import { useSidebar } from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { useMediaQuery } from "@/hooks/use-media-query";
import { appHost } from "@/host";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const ROOM_BESIDE_OPEN_SIDEBAR = "(min-width: 73rem)";
const ROOM_BESIDE_COLLAPSED_SIDEBAR = "(min-width: 61rem)";

const sectionIcon = (section: SettingsSection): IconSvgElement => {
  switch (section) {
    case "account":
      return UserCircleIcon;
    case "organization":
      return Building03Icon;
    case "receipts":
      return Invoice03Icon;
    case "data":
      return Database01Icon;
    case "general":
      return Settings01Icon;
  }
};

export const useSettingsSections = (): ReadonlyArray<SettingsSection> => {
  const signedIn = useAuth().snapshot?.status === "authenticated";
  return availableSettingsSections({
    signedIn,
    keepsDataOnDevice: appHost().backup !== undefined,
  });
};

export function SettingsLayout() {
  const sections = useSettingsSections();
  const { section } = useParams({ strict: false });
  const { open } = useSidebar();
  const sideBySide = useMediaQuery(open ? ROOM_BESIDE_OPEN_SIDEBAR : ROOM_BESIDE_COLLAPSED_SIDEBAR);

  return (
    <PageLayout>
      <Tabs
        className="mx-auto w-full max-w-5xl"
        orientation={sideBySide ? "vertical" : "horizontal"}
        value={section ?? null}
      >
        <div
          className={cn(
            sideBySide
              ? "sticky top-4 me-4 w-48 shrink-0 self-start border-s"
              : "mb-2 scrollbar-none overflow-x-auto",
          )}
        >
          <div className={cn(!sideBySide && "w-max min-w-full border-b")}>
            <TabsList
              aria-label="Settings"
              className={cn(sideBySide && "w-full")}
              variant="underline"
            >
              {sections.map((item) => (
                <TabsTab
                  key={item}
                  nativeButton={false}
                  render={<Link params={{ section: item }} to="/settings/$section" />}
                  value={item}
                >
                  <HugeiconsIcon aria-hidden="true" icon={sectionIcon(item)} />
                  {settingsSectionTitle(item)}
                </TabsTab>
              ))}
            </TabsList>
          </div>
        </div>
        <TabsPanel className="max-w-3xl min-w-0" value={section ?? null}>
          <div className="flex flex-col gap-4">
            <Outlet />
          </div>
        </TabsPanel>
      </Tabs>
    </PageLayout>
  );
}
