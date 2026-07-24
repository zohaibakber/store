import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { EyeIcon, EyeClosedIcon } from "@hugeicons/core-free-icons";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Button } from "../ui/button";

export function AuthPasswordInput({
  value,
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof InputGroupInput>, "type">) {
  const [showPassword, setShowPassword] = React.useState(false);

  return (
    <InputGroup>
      <InputGroupInput
        type={showPassword ? "text" : "password"}
        value={value}
        onChange={onChange}
        {...props}
      />
      {typeof value === "string" && value.length > 0 && (
        <InputGroupAddon align="inline-end">
          <Button
            type="button"
            size="icon-xs"
            aria-label={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((current) => !current)}
          >
            <HugeiconsIcon icon={showPassword ? EyeClosedIcon : EyeIcon} />
          </Button>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}
