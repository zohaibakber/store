import type * as React from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { NumberField, NumberFieldInput } from "@/components/ui/number-field";
import { cn } from "@/lib/utils";

const controlGroupSelectTrigger =
  "w-fit min-w-0 border-0 bg-transparent! shadow-none before:hidden focus-visible:ring-0";

function ControlGroup(props: React.ComponentProps<typeof InputGroup>): React.ReactElement {
  return <InputGroup {...props} />;
}

function ControlGroupNumberInput({
  children,
  inputProps,
  ...props
}: React.ComponentProps<typeof NumberField> & {
  inputProps?: React.ComponentProps<typeof NumberFieldInput>;
}): React.ReactElement {
  return (
    <NumberField className="contents" {...props}>
      <NumberFieldInput {...inputProps} className={cn("text-left", inputProps?.className)} />
      {children}
    </NumberField>
  );
}

function ControlGroupInput(
  props: React.ComponentProps<typeof InputGroupInput>,
): React.ReactElement {
  return <InputGroupInput {...props} />;
}

function ControlGroupAddon({
  align = "inline-end",
  ...props
}: React.ComponentProps<typeof InputGroupAddon>): React.ReactElement {
  return <InputGroupAddon align={align} {...props} />;
}

function ControlGroupText(props: React.ComponentProps<typeof InputGroupText>): React.ReactElement {
  return <InputGroupText {...props} />;
}

export {
  ControlGroup,
  ControlGroupAddon,
  ControlGroupInput,
  ControlGroupNumberInput,
  ControlGroupText,
  controlGroupSelectTrigger,
};
