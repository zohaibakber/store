import type { ComponentProps } from "react";

export function GoogleIcon(props: Omit<ComponentProps<"img">, "alt" | "src">) {
  return <img {...props} alt="" src="/google.svg" />;
}
