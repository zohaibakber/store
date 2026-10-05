import { useEffect, useEffectEvent } from "react";

const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel"] as const;

const MILLIS_PER_MINUTE = 60_000;

export function useIdleLock(minutes: number | null, lock: () => void): void {
  const onIdle = useEffectEvent(lock);

  useEffect(() => {
    if (minutes === null) return;
    const millis = minutes * MILLIS_PER_MINUTE;
    let timer = window.setTimeout(onIdle, millis);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(onIdle, millis);
    };
    const options = { capture: true, passive: true };
    for (const type of INPUT_EVENTS) window.addEventListener(type, reset, options);
    return () => {
      window.clearTimeout(timer);
      for (const type of INPUT_EVENTS) window.removeEventListener(type, reset, options);
    };
  }, [minutes]);
}
