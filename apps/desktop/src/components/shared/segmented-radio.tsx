import type * as React from "react";

import { RadioGroupPrimitive, RadioPrimitive } from "@/components/ui/radio-group";
import {
  segmentedControlItemVariants,
  segmentedControlRootClassName,
} from "@/lib/segmented-control";

const itemClassName = segmentedControlItemVariants({ size: "sm", state: "checked" });

export type SegmentedOption<Value extends string> = {
  readonly value: Value;
  readonly label: React.ReactNode;
};

export function SegmentedRadio<Value extends string>({
  label,
  onValueChange,
  options,
  value,
}: {
  readonly label: string;
  readonly options: ReadonlyArray<SegmentedOption<Value>>;
  readonly value: Value;
  readonly onValueChange: (value: Value) => void;
}) {
  return (
    <RadioGroupPrimitive
      aria-label={label}
      render={<div className={segmentedControlRootClassName} />}
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.value === next);
        if (option) onValueChange(option.value);
      }}
      value={value}
    >
      {options.map((option) => (
        <RadioPrimitive.Root className={itemClassName} key={option.value} value={option.value}>
          {option.label}
        </RadioPrimitive.Root>
      ))}
    </RadioGroupPrimitive>
  );
}
