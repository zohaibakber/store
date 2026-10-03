# Components

Only what the installed source does not make obvious. A component missing from `apps/web/src/components/ui` is added first; see the skill's "Add a component".

## Choosing

| Need | Use |
| --- | --- |
| Blocking, centred, needs focus | `Dialog` |
| Confirming something destructive | `AlertDialog` |
| Panel from an edge | `Sheet`; `Drawer` for a mobile bottom panel |
| Anchored, non-blocking, may hold controls | `Popover` |
| Short text hint, nothing interactive | `Tooltip` |
| Rich preview on hover | `PreviewCard` |
| Actions on click | `Menu`; `ContextMenu` on right click |
| Actions the user searches | `Command` |
| One of a fixed list | `Select`; `RadioGroup` when two or three options should stay visible |
| One of a strict list, with typing to filter | `Combobox` |
| Free text with suggestions | `Autocomplete` |
| A setting that is on or off | `Switch` |
| A boolean in a form, such as agreeing to terms | `Checkbox`; `CheckboxGroup` for several of a set |
| A command with a pressed state | `Toggle`; `ToggleGroup` when they share state |
| Inline status that stays | `Alert` |
| Feedback that goes away | `Toast` |
| Progress of a task | `Progress`; omit `value` when it is unknown |
| A bounded measurement | `Meter` |
| Waiting with nothing to measure | `Button loading` first, then `Spinner` |
| Placeholder shaped like the content | `Skeleton` |
| Nothing to show | `Empty`, with a next step in `EmptyContent` |
| A sectioned container | `Card` |
| One border around a table or list | `Frame` |
| Controls joined into one shape | `Group` with `GroupSeparator` between them |

## Overlays

- **Dialog.** Long content scrolls inside `DialogPanel`. Open it from elsewhere (a menu item, a shortcut) with controlled `open` and `onOpenChange`. Closing with unsaved changes is a controlled `Dialog` that opens an `AlertDialog`. `showCloseButton={false}` when the footer has its own close. `DialogFooter variant="bare"` removes the framed footer.
- **AlertDialog.** It has a header and a footer and no panel. Cancel and confirm are `AlertDialogClose render={<Button … />}`; pair a `destructive-outline` trigger with a `destructive` confirm.
- **Sheet.** `side` is `top`, `right`, `bottom` or `left`.
- **Popover.** `tooltipStyle` gives tooltip density for an info-icon helper. `PopoverClose render={<Button … />}` for a close control. One popup shared by several triggers uses `PopoverCreateHandle` with a `handle` and `payload`.
- **Tooltip.** It never replaces the accessible name of an icon-only control.
- **Menu.** Items take `onClick`. A submenu is `MenuSubTrigger` with `MenuSubPopup`. Grouped items sit in `MenuGroup`. Decide `closeOnClick` for items that toggle instead of act.
- **Command.** The palette is `CommandDialog`, `CommandDialogTrigger`, `CommandDialogPopup` around `Command`, opened by a shortcut through controlled `open`. It is built on Dialog and Autocomplete.

## Selection

- **Select.** Pass `items` to the root and map the same array inside `SelectPopup`. `SelectValue` goes inside `SelectTrigger` and carries the `placeholder`. `multiple` makes the value an array. Object values need `itemToStringValue`. `alignItemWithTrigger={false}` only when the default alignment breaks the layout.
- **Combobox and Autocomplete.** Always render the `*Empty` part. Object items need `itemToStringValue`. Remote search: `filter={null}`, controlled `value` and `onValueChange`, and handle loading, failure and a stale response.
- **RadioGroup** yields one value; **CheckboxGroup** yields an array. A checkbox may be indeterminate, so `onCheckedChange` is not always a plain boolean.
- **ToggleGroup** and **Accordion** values are arrays.
- **Slider.** A single value is a number, a range is an array.

## Inputs

- **InputGroup.** Use `InputGroupInput` or `InputGroupTextarea`, and place `InputGroupAddon` after it in the DOM; focus handling depends on that order.
- **Textarea** already is a field control. Use it directly inside `Field`.
- **NumberField.** Set `min`, `max` and `step`; the value is clamped. Size goes on `NumberFieldGroup`.
- **OTPField.** `length` on the root equals the number of `OTPFieldInput` children. Label the root; the first slot carries no label of its own.
- **Form.** `onSubmit` gives native `FormData`; `onFormSubmit` gives the parsed values object. With TanStack Form, forward the input ref and map invalid, touched and dirty onto `Field`, so focus-on-error works.

## Layout and data

- **Table.** It renders; sorting, selection and paging come from TanStack Table. `TableHead` in the header, `TableCell` in the body. An empty result is one row whose `colSpan` equals the visible columns. `variant="card"` gives separated rows; wrap in `Frame` for a framed surface. `table-fixed` with column widths for predictable sizing.
- **ScrollArea.** It needs a height constraint. Horizontal scroll comes from wide content, not a prop. `fill` only when the content must stretch to the viewport, as a sidebar body that pins a footer with `mt-auto`; then the root also takes `flex-1 min-h-0`. Leave `clampContentMinWidth` at its default.
- **Sidebar.** `SidebarProvider` wraps it. Navigation is `SidebarMenu` > `SidebarMenuItem` > `SidebarMenuButton`, inside `SidebarContent`.
- **Tabs.** Each `TabsTab value` matches a `TabsPanel value`. Route-level navigation is routes, not tabs.
- **Toolbar.** Every control goes through `ToolbarButton render={<Button … />}` or `render={<ToggleGroupItem … />}`, with `ToolbarSeparator` between `ToolbarGroup`s.
- **Skeleton.** Mirror the geometry of the content it stands in for.
- **Kbd.** One `Kbd` per key, inside `KbdGroup`.
- **Avatar.** Always include `AvatarFallback`.

## Feedback

- **Toast.** Call `toastManager.add({ title, description, type })`; the provider is already mounted in `routes/__root.tsx`. A stable `id` updates the existing toast in place. A toast tied to an element uses `anchoredToastManager.add` with `positionerProps.anchor`, and needs `AnchoredToastProvider` mounted.
- **Alert.** Variants are `default`, `info`, `success`, `warning`, `error`. Actions go in `AlertAction`.
- **Button.** `loading` disables it and shows the spinner. Sizes run `xs` to `xl`, with `icon-sm`, `icon` and `icon-lg` for icon-only. `SelectButton` is a select-style trigger for comboboxes, not a general button.
