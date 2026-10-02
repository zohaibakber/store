import type * as React from "react";

import { InputGroup, InputGroupAddon, InputGroupText } from "@/components/ui/input-group";
import { NumberField, NumberFieldInput } from "@/components/ui/number-field";
import { isString } from "@/lib/predicates";

export function NumberControl({
  addon,
  inputProps,
  ...props
}: Omit<React.ComponentProps<typeof NumberField>, "children"> & {
  readonly addon: React.ReactNode;
  readonly inputProps?: React.ComponentProps<typeof NumberFieldInput>;
}): React.ReactElement {
  return (
    <InputGroup>
      <NumberField className="contents" {...props}>
        <NumberFieldInput {...inputProps} />
      </NumberField>
      <InputGroupAddon align="inline-end">
        {isString(addon) ? <InputGroupText>{addon}</InputGroupText> : addon}
      </InputGroupAddon>
    </InputGroup>
  );
}
