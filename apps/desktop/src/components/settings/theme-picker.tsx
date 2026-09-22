import { useTheme, type ThemePreference } from "@/components/theme/provider";
import { Field, FieldItem, FieldLabel } from "@/components/ui/field";
import { Fieldset, FieldsetLegend } from "@/components/ui/fieldset";
import { Radio, RadioGroup } from "@/components/ui/radio-group";

const options: ReadonlyArray<{ label: string; value: ThemePreference }> = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

const previews = {
  dark: (
    <svg aria-hidden="true" className="size-full" fill="none" viewBox="0 0 88 70">
      <path className="fill-(--color-neutral-900)" d="M0 0h88v70H0z" />
      <path className="fill-(--color-neutral-800)" d="M10 12a4 4 0 0 1 4-4h74v62H10V12Z" />
      <circle className="fill-(--color-neutral-600)" cx="28" cy="26" r="8" />
      <rect className="fill-(--color-neutral-700)" height="4" rx="2" width="58" x="20" y="42" />
      <rect className="fill-(--color-neutral-700)" height="4" rx="2" width="42" x="20" y="52" />
    </svg>
  ),
  light: (
    <svg aria-hidden="true" className="size-full" fill="none" viewBox="0 0 88 70">
      <path className="fill-(--color-neutral-100)" d="M0 0h88v70H0z" />
      <path className="fill-white" d="M10 12a4 4 0 0 1 4-4h74v62H10V12Z" />
      <circle className="fill-(--color-neutral-300)" cx="28" cy="26" r="8" />
      <rect className="fill-(--color-neutral-200)" height="4" rx="2" width="58" x="20" y="42" />
      <rect className="fill-(--color-neutral-200)" height="4" rx="2" width="42" x="20" y="52" />
    </svg>
  ),
  system: (
    <svg aria-hidden="true" className="size-full" fill="none" viewBox="0 0 88 70">
      <path className="fill-(--color-neutral-100)" d="M0 0h44v70H0z" />
      <path className="fill-(--color-neutral-900)" d="M44 0h44v70H44z" />
      <path className="fill-white" d="M10 12a4 4 0 0 1 4-4h30v62H10V12Z" />
      <path className="fill-(--color-neutral-800)" d="M44 8h44v62H44V8Z" />
      <circle className="fill-(--color-neutral-300)" cx="28" cy="26" r="8" />
      <circle className="fill-(--color-neutral-600)" cx="60" cy="26" r="8" />
    </svg>
  ),
} satisfies Record<ThemePreference, React.ReactNode>;

export function ThemePicker() {
  const { preference, setTheme } = useTheme();

  return (
    <Field name="theme" render={(props) => <Fieldset {...props} />}>
      <FieldsetLegend>Theme</FieldsetLegend>
      <RadioGroup
        onValueChange={(value) => {
          const option = options.find((entry) => entry.value === value);
          if (option) setTheme(option.value);
        }}
        value={preference}
      >
        <div className="flex gap-4">
          {options.map((option) => (
            <FieldItem key={option.value}>
              <FieldLabel className="cursor-pointer flex-col">
                <Radio value={option.value} />
                <span className="relative block h-17.5 w-22 overflow-hidden rounded-lg shadow-xs transition-shadow not-peer-data-checked:opacity-80 peer-data-checked:ring-2 peer-data-checked:ring-primary/48 peer-data-checked:ring-offset-1 peer-data-checked:ring-offset-background">
                  {previews[option.value]}
                </span>
                <span className="not-peer-data-checked:text-muted-foreground/70">
                  {option.label}
                </span>
              </FieldLabel>
            </FieldItem>
          ))}
        </div>
      </RadioGroup>
    </Field>
  );
}
