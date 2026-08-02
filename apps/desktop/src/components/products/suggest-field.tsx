import { useMemo } from "react";

import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "@/components/ui/autocomplete";

/**
 * Free text, with what the catalog already uses offered as you type. The
 * suggestions are whole values typed before — a product name, an aisle, a
 * composition — so the same thing does not end up spelled three ways.
 */
export function SuggestField({
  autoFocus,
  emptyMessage,
  id,
  invalid,
  name,
  onBlur,
  onChange,
  placeholder,
  suggestions,
  value,
}: {
  autoFocus?: boolean;
  emptyMessage: string;
  id?: string;
  invalid?: boolean;
  name?: string;
  onBlur?: () => void;
  onChange: (value: string) => void;
  placeholder?: string;
  suggestions: ReadonlyArray<string>;
  value: string;
}) {
  // A value the user is still typing is not a suggestion worth offering.
  const items = useMemo(
    () => suggestions.filter((suggestion) => suggestion !== value.trim()),
    [suggestions, value],
  );

  return (
    <Autocomplete
      items={items as string[]}
      onValueChange={(next: string) => onChange(next)}
      value={value}
    >
      <AutocompleteInput
        aria-invalid={invalid || undefined}
        autoFocus={autoFocus}
        className="w-full"
        id={id}
        name={name}
        onBlur={onBlur}
        placeholder={placeholder}
      />
      <AutocompletePopup>
        <AutocompleteEmpty>{emptyMessage}</AutocompleteEmpty>
        <AutocompleteList>
          {(suggestion: string) => (
            <AutocompleteItem key={suggestion} value={suggestion}>
              <span className="truncate">{suggestion}</span>
            </AutocompleteItem>
          )}
        </AutocompleteList>
      </AutocompletePopup>
    </Autocomplete>
  );
}
