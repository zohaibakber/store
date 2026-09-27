import { Calendar03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { format } from "date-fns";
import * as React from "react";
import type { DropdownProps } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "@/components/ui/combobox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface CalendarDropdownItem {
  disabled?: boolean;
  label: string;
  value: string;
}

function CalendarDropdown({ options, value, onChange, "aria-label": ariaLabel }: DropdownProps) {
  const items: CalendarDropdownItem[] =
    options?.map((option) => ({
      disabled: option.disabled,
      label: option.label,
      value: option.value.toString(),
    })) ?? [];
  const selectedItem = items.find((item) => item.value === value?.toString());

  return (
    <Combobox
      aria-label={ariaLabel}
      autoHighlight
      items={items}
      onValueChange={(newValue) => {
        if (!newValue) return;
        // SAFETY: This adapter supplies the select value fields consumed by the shared handler.
        onChange?.({
          target: { value: newValue.value },
        } as React.ChangeEvent<HTMLSelectElement>);
      }}
      value={selectedItem}
    >
      <ComboboxInput
        className="**:[input]:w-0 **:[input]:flex-1"
        onFocus={(event) => event.currentTarget.select()}
      />
      <ComboboxPopup aria-label={ariaLabel}>
        <ComboboxEmpty>No items found.</ComboboxEmpty>
        <ComboboxList>
          {(item: CalendarDropdownItem) => (
            <ComboboxItem disabled={item.disabled} key={item.value} value={item}>
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

const digitsOf = (text: string) => text.replace(/\D/g, "").slice(0, 6);

const slashedMonthYear = (digits: string) =>
  digits.length <= 2 ? digits : `${digits.slice(0, 2)}/${digits.slice(2)}`;

const lastDayOfMonth = (year: number, month: number) => new Date(year, month, 0);

const lastDayOfTypedMonthYear = (text: string): Date | undefined => {
  const digits = digitsOf(text);
  if (digits.length !== 4 && digits.length !== 6) return undefined;
  const month = Number(digits.slice(0, 2));
  if (month < 1 || month > 12) return undefined;
  const yearDigits = digits.slice(2);
  const year = yearDigits.length === 2 ? 2000 + Number(yearDigits) : Number(yearDigits);
  return lastDayOfMonth(year, month);
};

const monthYearText = (date: Date | undefined) => (date ? format(date, "MM/yy") : "");

export function ExpiryPicker({
  id,
  name,
  value,
  onChange,
  onBlur,
  placeholder = "MM/YY",
  disabled,
  invalid,
  startMonth,
  endMonth,
}: {
  id?: string;
  name?: string;
  value?: Date;
  onChange: (date: Date | undefined) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  startMonth?: Date;
  endMonth?: Date;
}) {
  const [open, setOpen] = React.useState(false);
  const [typedText, setTypedText] = React.useState<string | null>(null);
  const text = typedText ?? monthYearText(value);

  const handleChange = (next: string) => {
    const digits = digitsOf(next);
    setTypedText(slashedMonthYear(digits));
    if (digits.length === 0) return onChange(undefined);
    const completeExpiry = lastDayOfTypedMonthYear(digits);
    if (completeExpiry) onChange(completeExpiry);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onBlur?.();
      }}
    >
      <InputGroup>
        <InputGroupInput
          aria-invalid={invalid || undefined}
          autoComplete="off"
          disabled={disabled}
          id={id}
          inputMode="numeric"
          name={name}
          onBlur={() => {
            setTypedText(null);
            onBlur?.();
          }}
          onChange={(event) => handleChange(event.target.value)}
          placeholder={placeholder}
          value={text}
        />
        <InputGroupAddon align="inline-end">
          <PopoverTrigger
            render={
              <Button
                aria-label="Pick an expiry date"
                disabled={disabled}
                size="icon-xs"
                type="button"
                variant="ghost"
              />
            }
          >
            <HugeiconsIcon aria-hidden="true" icon={Calendar03Icon} />
          </PopoverTrigger>
        </InputGroupAddon>
      </InputGroup>
      <PopoverContent align="end" className="w-auto">
        <Calendar
          mode="single"
          selected={value}
          defaultMonth={value ?? startMonth}
          captionLayout="dropdown"
          components={{ Dropdown: CalendarDropdown }}
          startMonth={startMonth}
          endMonth={endMonth}
          onSelect={(date) => {
            onChange(date);
            setTypedText(null);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
