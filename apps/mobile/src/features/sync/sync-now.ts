import * as React from "react";

import { useSyncNow } from "@/inventory";

export function useSyncRefresh() {
  const syncNow = useSyncNow();
  const [refreshing, setRefreshing] = React.useState(false);
  const refresh = () => {
    setRefreshing(true);
    void syncNow().finally(() => setRefreshing(false));
  };
  return { refreshing, refresh, syncNow };
}
