import { useTheme, type ThemePreference } from "@/components/theme-provider";
import { Field, FieldItem, FieldLabel } from "@/components/ui/field";
import { Fieldset, FieldsetLegend } from "@/components/ui/fieldset";
import { Radio, RadioGroup } from "@/components/ui/radio-group";

const options: ReadonlyArray<{ label: string; value: ThemePreference }> = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

// Miniature app previews, drawn from neutral steps rather than theme tokens so
// each swatch shows its own theme regardless of the one in use.
const previews: Record<ThemePreference, React.ReactNode> = {
  dark: (
    <svg aria-hidden="true" className="size-full" fill="none" viewBox="0 0 88 70">
      <path className="fill-neutral-900" d="M0 0h88v70H0z" />
      <path className="fill-neutral-800" d="M10 12a4 4 0 0 1 4-4h74v62H10V12Z" />
      <circle className="fill-neutral-600" cx="28" cy="26" r="8" />
      <rect className="fill-neutral-700" height="4" rx="2" width="58" x="20" y="42" />
      <rect className="fill-neutral-700" height="4" rx="2" width="42" x="20" y="52" />
    </svg>
  ),
  light: (
    <svg aria-hidden="true" className="size-full" fill="none" viewBox="0 0 88 70">
      <path className="fill-neutral-100" d="M0 0h88v70H0z" />
      <path className="fill-white" d="M10 12a4 4 0 0 1 4-4h74v62H10V12Z" />
      <circle className="fill-neutral-300" cx="28" cy="26" r="8" />
      <rect className="fill-neutral-200" height="4" rx="2" width="58" x="20" y="42" />
      <rect className="fill-neutral-200" height="4" rx="2" width="42" x="20" y="52" />
    </svg>
  ),
  system: (
    <svg aria-hidden="true" className="size-full" fill="none" viewBox="0 0 88 70">
      <path className="fill-neutral-100" d="M0 0h44v70H0z" />
      <path className="fill-neutral-900" d="M44 0h44v70H44z" />
      <path className="fill-white" d="M10 12a4 4 0 0 1 4-4h30v62H10V12Z" />
      <path className="fill-neutral-800" d="M44 8h44v62H44V8Z" />
      <circle className="fill-neutral-300" cx="28" cy="26" r="8" />
      <circle className="fill-neutral-600" cx="60" cy="26" r="8" />
    </svg>
  ),
};

export function ThemePicker() {
  const { preference, setTheme } = useTheme();

  return (
    <Field className="gap-4" name="theme" render={(props) => <Fieldset {...props} />}>
      <FieldsetLegend className="text-sm font-medium">Theme</FieldsetLegend>
      <RadioGroup
        className="flex-row gap-4"
        onValueChange={(value) => value && setTheme(value as ThemePreference)}
        value={preference}
      >
        {options.map((option) => (
          <FieldItem key={option.value}>
            <FieldLabel className="cursor-pointer flex-col">
              {/* The preview swatch is the control, so the radio box is
                  collapsed. The Radio sets both `size-4.5` and `sm:size-4`;
                  those are separate variant groups to tailwind-merge, so the
                  responsive one has to be overridden too or it wins at ≥640px. */}
              <Radio
                className="peer absolute size-px overflow-hidden border-0 p-0 opacity-0 sm:size-px"
                value={option.value}
              />
              <span className="relative block h-17.5 w-22 overflow-hidden rounded-lg shadow-xs transition-shadow not-peer-data-checked:opacity-80 peer-data-checked:ring-2 peer-data-checked:ring-primary/48 peer-data-checked:ring-offset-1 peer-data-checked:ring-offset-background">
                {previews[option.value]}
              </span>
              <span className="not-peer-data-checked:text-muted-foreground/70">{option.label}</span>
            </FieldLabel>
          </FieldItem>
        ))}
      </RadioGroup>
    </Field>
  );
}
