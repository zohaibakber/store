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
 * suggestions are whole compositions typed before, so the same active
 * ingredient does not end up spelled three ways.
 */
export function CompositionField({
  id,
  invalid,
  name,
  onBlur,
  onChange,
  suggestions,
  value,
}: {
  id?: string;
  invalid?: boolean;
  name?: string;
  onBlur?: () => void;
  onChange: (composition: string) => void;
  suggestions: ReadonlyArray<string>;
  value: string;
}) {
  // A composition the user is still typing is not a suggestion worth offering.
  const items = useMemo(
    () => suggestions.filter((composition) => composition !== value.trim()),
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
        className="w-full"
        id={id}
        name={name}
        onBlur={onBlur}
        placeholder="e.g. Paracetamol"
      />
      <AutocompletePopup>
        <AutocompleteEmpty>No matching composition.</AutocompleteEmpty>
        <AutocompleteList>
          {(composition: string) => (
            <AutocompleteItem key={composition} value={composition}>
              <span className="truncate">{composition}</span>
            </AutocompleteItem>
          )}
        </AutocompleteList>
      </AutocompletePopup>
    </Autocomplete>
  );
}
