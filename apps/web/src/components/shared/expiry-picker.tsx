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

/** Types as `0826`, reads back as `08/26`. */
const withSeparator = (digits: string) =>
  digits.length <= 2 ? digits : `${digits.slice(0, 2)}/${digits.slice(2)}`;

/**
 * A month and a year is all a package tells you, so `08/26` resolves to the
 * last day of that month, the last day the stock is good. A four-digit year
 * is accepted too; anything shorter is still being typed.
 */
const parseMonthYear = (text: string): Date | undefined => {
  const digits = digitsOf(text);
  if (digits.length !== 4 && digits.length !== 6) return undefined;
  const month = Number(digits.slice(0, 2));
  if (month < 1 || month > 12) return undefined;
  const yearDigits = digits.slice(2);
  const year = yearDigits.length === 2 ? 2000 + Number(yearDigits) : Number(yearDigits);
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month, 0);
};

const monthYearText = (date: Date | undefined) => (date ? format(date, "MM/yy") : "");

/**
 * Expiry as it is printed on stock: a month and a year, typed as `MM/YY`. The
 * calendar button beside it stays available for a precise day.
 */
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
  // Only held while the field is being typed into. Everywhere else the text is
  // the saved date, so a calendar pick or a form reset needs no syncing.
  const [draft, setDraft] = React.useState<string | null>(null);
  const text = draft ?? monthYearText(value);

  const handleChange = (next: string) => {
    const digits = digitsOf(next);
    setDraft(withSeparator(digits));
    // Half-typed input leaves the saved date alone; clearing the field clears it.
    if (digits.length === 0) return onChange(undefined);
    const parsed = parseMonthYear(digits);
    if (parsed) onChange(parsed);
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
          // Dropping the draft also drops input that never became a month and year.
          onBlur={() => {
            setDraft(null);
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
      <PopoverContent align="end" className="w-auto p-0">
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
            setDraft(null);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
