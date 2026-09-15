import { Link } from "@tanstack/react-router";

import {
  segmentedControlItemVariants,
  segmentedControlRootClassName,
} from "@/lib/segmented-control";

const itemClassName = segmentedControlItemVariants({
  state: "current",
});

const sections = [
  { to: "/settings/account", label: "Account" },
  { to: "/settings/organization", label: "Organization" },
  { to: "/settings/categories", label: "Categories" },
  { to: "/settings/appearance", label: "Appearance" },
  { to: "/settings/about", label: "About" },
] as const;

export function SettingsNav() {
  return (
    <nav aria-label="Settings sections" className="overflow-x-auto">
      <div className={segmentedControlRootClassName}>
        {sections.map((section) => (
          <Link
            activeProps={{ "aria-current": "page" }}
            className={itemClassName}
            key={section.to}
            to={section.to}
          >
            {section.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
