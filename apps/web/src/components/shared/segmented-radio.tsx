import type * as React from "react";

import { RadioGroupPrimitive, RadioPrimitive } from "@/components/ui/radio-group";

const rootClassName =
  "relative z-0 flex w-fit items-center justify-center gap-0.5 rounded-lg bg-muted p-0.5";

const itemClassName =
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent text-base font-medium whitespace-nowrap text-muted-foreground/72 outline-2 outline-transparent transition-colors select-none hover:bg-transparent hover:text-muted-foreground focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-64 sm:text-sm data-disabled:pointer-events-none data-disabled:opacity-64 gap-1.5 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:-mx-0.5 [&_svg]:shrink-0 h-7.5 px-2 sm:h-6.5 data-checked:bg-background data-checked:text-foreground data-checked:shadow-sm/5 dark:data-checked:bg-input";

type SegmentedOption<Value extends string> = {
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
      render={<div className={rootClassName} />}
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
