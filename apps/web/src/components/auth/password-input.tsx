import { EyeClosedIcon, EyeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import type { InputProps } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

export function PasswordInput({
  className,
  ...props
}: Omit<InputProps, "className" | "type"> & { className?: string }): React.ReactElement {
  const [visible, setVisible] = React.useState(false);

  return (
    <InputGroup className={className}>
      <InputGroupInput type={visible ? "text" : "password"} {...props} />
      <InputGroupAddon align="inline-end">
        <Button
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden="true" icon={visible ? EyeClosedIcon : EyeIcon} />
        </Button>
      </InputGroupAddon>
    </InputGroup>
  );
}
