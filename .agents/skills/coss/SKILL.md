---
name: coss
description: COSS UI components on Base UI. Choosing a component, composing overlays and forms, styling, finding a particle example, and adding a component. Use when writing or reviewing UI that composes primitives installed from the `@coss` shadcn registry.
---

# COSS UI

The installed component is the authority. The app's `components.json` says where everything is: `aliases.ui` is the component directory, `iconLibrary` the icon set, `tailwind.css` the stylesheet, and its own directory is where `shadcn` commands run. Read `<ui>/<name>.tsx` for the exports, props, variants and `data-slot` names before composing with it; upstream docs describe a version the app may not have.

The project's own rules (typography, a design lint, who may edit the component directory) are in its `AGENTS.md` or `CLAUDE.md`. Where they differ from this skill, they win.

## Compose

- Base UI composes with `render`: `<DialogTrigger render={<Button variant="outline" />}>Open</DialogTrigger>`. The same goes for close buttons, menu triggers and toolbar buttons.
- Floating content is `*Popup` (`DialogPopup`, `MenuPopup`, `SelectPopup`). Each component has its own trigger and popup hierarchy; follow that component's parts.
- Sectioned surfaces keep their sections as direct children: `DialogHeader`, `DialogPanel`, `DialogFooter` in `DialogPopup`; `CardHeader`, `CardPanel`, `CardFooter` in `Card`. A wrapper that must sit between them takes `className="contents"`.
- Compose existing primitives before building a control. A bespoke dropdown or modal loses focus handling and keyboard behaviour.
- Portal behaviour (`container`, `keepMounted`) is set with `portalProps` on a `*Popup`, or on `ToastProvider` and `AnchoredToastProvider`. Placement is `side`, `align` and `sideOffset`.

## Forms

- A form control lives in `Field` with `FieldLabel`, and `FieldDescription` or `FieldError` as needed. Every control has a `name`.
- Every `Input` has an explicit `type`, and every `Button` an explicit `type` (`button`, `submit`, `reset`).
- A control with no visible label has `aria-label`. An icon-only button always does.
- Grouped checkboxes and radios sit in `Fieldset` with a `FieldsetLegend`.
- A form inside a dialog, sheet or drawer: header outside, `<Form className="contents">` around panel and footer.

## Style

- Reach for `variant` and `size` props before classes. Application code passes layout classes only; restyling, raw colours, arbitrary values and inline styles stay inside the component directory.
- Colours are semantic tokens (`text-muted-foreground`, `bg-destructive`).
- Layout is `flex` with `gap-*`; squares are `size-*`; conditional classes go through `cn()`.
- Icons come from the library `components.json` names. Size and opacity come from the parent component's styles; add a `size-*` class only to override, and never a numeric `size` prop. A decorative icon has `aria-hidden="true"`; an icon that carries the meaning, such as an alert's status icon, stays visible to assistive tech.
- Hover and state styling keyed to a parent uses `in-[[data-slot=button]:hover]:…` in place of `group`.
- Cancel and close buttons in overlay footers are `variant="ghost"`. `outline` is for the trigger that opens the overlay.
- `--alpha(var(--color-black) / 8%)` in the stylesheet is valid Tailwind v4. Leave it as written.

## Find an example

Particles are upstream's composed examples, named `p-<component>-<n>`.

```bash
pnpm exec shadcn search @coss -q "combobox"
pnpm exec shadcn view @coss/p-combobox-7
```

Run these from the directory that holds `components.json`, through the project's package manager. The search lists every particle for a component with a one-line description; `view` prints the registry item, source included. Adapt the source to the installed components: swap its icons for the project's icon library, fix import paths to the `ui` alias, and apply the project's typography rules. Treat it as reading material; adding a particle with `shadcn add` writes files.

Component docs are at `https://coss.com/ui/docs/components/<name>.md`.

## Add a component

`pnpm exec shadcn add @coss/<name> --dry-run` shows what would change; drop `--dry-run` to write it. Files in the component directory stay as upstream ships them, so a behaviour change belongs in application code that composes the primitive.

## Reference

Choosing between similar components, and the rules one component needs: [components](references/components.md).

## Done when

Every component in the change is used with the parts and props its installed file exports, every control has a label and an explicit `type`, and the project's lint passes.
