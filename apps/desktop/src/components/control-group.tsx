import type * as React from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { NumberField, NumberFieldInput } from "@/components/ui/number-field";
import { cn } from "@/lib/utils";

// A single bordered field that fuses a text/number input with a trailing (or
// leading) select or suffix — "500 | mg", "12 | Unit", "250 | PKR".
//
// coss composes this with InputGroup rather than a button-group wrapper: the
// InputGroup owns the one border, background and focus ring, and everything
// inside it renders bare. That matters because coss's SelectTrigger defaults to
// `w-full min-w-36`, so a trigger placed beside an input as a sibling claims a
// 9rem floor and crushes the control next to it.
//
//   <ControlGroup>
//     <ControlGroupNumberInput min={0} onValueChange={setValue} value={value}
//       inputProps={{ "aria-label": "Strength value", placeholder: "500" }} />
//     <ControlGroupAddon>
//       <Select items={units} onValueChange={setUnit} value={unit}>
//         <SelectTrigger aria-label="Unit" className={controlGroupSelectTrigger}>
//           <SelectValue />
//         </SelectTrigger>
//         <SelectContent>{/* items */}</SelectContent>
//       </Select>
//     </ControlGroupAddon>
//   </ControlGroup>

/** Strips a SelectTrigger of its own chrome and width floor so it sits inside a ControlGroup. */
const controlGroupSelectTrigger =
  "w-fit min-w-0 border-0 bg-transparent! shadow-none before:hidden focus-visible:ring-0";

function ControlGroup(props: React.ComponentProps<typeof InputGroup>): React.ReactElement {
  return <InputGroup {...props} />;
}

/**
 * A NumberField whose root collapses to `display: contents`, so the input sits
 * directly in the group's flex row and the group's border is the only one.
 */
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
      {/* Steppers must stay inside the NumberField root to read its context;
          `contents` keeps them laid out by the surrounding group. */}
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
