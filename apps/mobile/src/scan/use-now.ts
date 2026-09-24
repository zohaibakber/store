import * as React from "react";

export const useNow = (enabled: boolean, intervalMillis = 1000): number => {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMillis);
    return () => clearInterval(timer);
  }, [enabled, intervalMillis]);
  return now;
};
