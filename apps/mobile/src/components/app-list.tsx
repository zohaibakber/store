import { Column, Host } from "@expo/ui";
import type { ReactNode } from "react";

import { useAppColorScheme } from "@/theme/appearance";

export function AppList({ children }: { children: ReactNode }) {
  const colorScheme = useAppColorScheme();

  return (
    <Host
      colorScheme={colorScheme}
      matchContents={{ horizontal: false, vertical: true }}
      style={{ width: "100%" }}
    >
      <Column>{children}</Column>
    </Host>
  );
}
