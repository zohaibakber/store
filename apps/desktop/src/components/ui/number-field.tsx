import type { ComponentProps } from "react";
import { Add01Icon, MinusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

function NumberField({ className, ...props }: NumberFieldPrimitive.Root.Props) {
  return (
    <NumberFieldPrimitive.Root
      data-slot="number-field"
      className={cn("w-fit", className)}
      {...props}
    />
  );
}

function NumberFieldGroup({ className, ...props }: NumberFieldPrimitive.Group.Props) {
  return (
    <NumberFieldPrimitive.Group
      data-slot="number-field-group"
      className={cn(
        "flex h-7 w-full min-w-0 items-center rounded-md border border-input bg-input/20 transition-colors outline-none has-[[data-slot=number-field-input]:focus-visible]:border-ring has-[[data-slot=number-field-input]:focus-visible]:ring-2 has-[[data-slot=number-field-input]:focus-visible]:ring-ring/30 has-aria-invalid:border-destructive has-aria-invalid:ring-2 has-aria-invalid:ring-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}

function NumberFieldInput({ className, ...props }: NumberFieldPrimitive.Input.Props) {
  return (
    <NumberFieldPrimitive.Input
      data-slot="number-field-input"
      className={cn(
        "h-full min-w-0 flex-1 bg-transparent px-2 text-center text-sm outline-none md:text-xs/relaxed",
        className,
      )}
      {...props}
    />
  );
}

const numberFieldAddonVariants = cva(
  "flex h-auto cursor-text items-center justify-center gap-1 py-2 text-xs/relaxed font-medium text-muted-foreground select-none",
  {
    variants: {
      align: {
        "inline-start": "order-first pl-2",
        "inline-end": "pr-2",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  },
);

function NumberFieldAddon({
  align = "inline-start",
  className,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof numberFieldAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="number-field-addon"
      data-align={align}
      className={cn(numberFieldAddonVariants({ align }), className)}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        event.currentTarget.parentElement
          ?.querySelector<HTMLInputElement>("[data-slot=number-field-input]")
          ?.focus();
      }}
      {...props}
    />
  );
}

const stepperClassName =
  "flex size-7 shrink-0 items-center justify-center outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:text-muted-foreground/50 disabled:opacity-50 [&_svg]:size-3";

function NumberFieldDecrement({ className, ...props }: NumberFieldPrimitive.Decrement.Props) {
  return (
    <NumberFieldPrimitive.Decrement
      data-slot="number-field-decrement"
      className={cn(stepperClassName, "rounded-l-md border-r border-input", className)}
      {...props}
    >
      <HugeiconsIcon aria-hidden="true" icon={MinusSignIcon} />
    </NumberFieldPrimitive.Decrement>
  );
}

function NumberFieldIncrement({ className, ...props }: NumberFieldPrimitive.Increment.Props) {
  return (
    <NumberFieldPrimitive.Increment
      data-slot="number-field-increment"
      className={cn(stepperClassName, "rounded-r-md border-l border-input", className)}
      {...props}
    >
      <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
    </NumberFieldPrimitive.Increment>
  );
}

export {
  NumberField,
  NumberFieldAddon,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
};
