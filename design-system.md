# Tabaaq design system

One visual language for three clients: **web** (`apps/web`, Tailwind v4 + coss),
**desktop** (`apps/desktop`, the same renderer in Electron) and **mobile**
(`apps/mobile`, React Native + `@expo/ui`).

The palette, type scale, radii and component vocabulary are defined once here.
Web and desktop consume them as CSS custom properties in
`apps/web/src/styles.css`. Mobile consumes the same numbers as literal tokens in
`apps/mobile/src/theme/tokens.ts`. When the two disagree, `styles.css` wins and
the mobile tokens are wrong.

Component recipes are derived from [coss ui](https://coss.com/ui) (Base UI +
Tailwind), which is what `apps/web/src/components/ui` already is. Mobile does not
re-implement coss; it borrows coss's **anatomy** (slot names, variants, states)
and paints it with native primitives.

---

## 1. Principles

1. **Neutral is the brand.** `primary` is `neutral-800` in light and
   `neutral-100` in dark. There is no accent hue. Color appears only to carry
   meaning: destructive, success, warning, info.
2. **One hierarchy per screen.** One filled button, one title, one primary list.
   Everything else is `outline`, `ghost` or `muted-foreground`.
3. **Subtract.** No gradients, no marketing chrome, no decorative shadows, no
   duplicate summaries of the same number.
4. **Native where it earns it.** Native tab bars, native lists, native sheets,
   native switches, native refresh, native scroll. Native _structure_, our
   _paint_ — never the platform's opinion about brand color.
5. **Tokens, never literals.** No hex in a component. If a value is missing from
   the token set, add it to the token set.
6. **Gap, not margin.** Spacing belongs to the container.

---

## 2. Color

### 2.1 Semantic tokens

Light and dark, sourced from `apps/web/src/styles.css`. Hex columns are the
resolved sRGB values that mobile uses (Tailwind v4 ships oklch; React Native
cannot parse it, so the mobile token file stores the converted hex and the
conversion is documented in that file).

| Token                   | Web variable               | Light                   | Dark                    | Use                                     |
| ----------------------- | -------------------------- | ----------------------- | ----------------------- | --------------------------------------- |
| `background`            | `--background`             | `#ffffff`               | `#161616`               | Screen behind everything                |
| `foreground`            | `--foreground`             | `#262626` (neutral-800) | `#f5f5f5` (neutral-100) | Primary text, icons                     |
| `card`                  | `--card`                   | `#ffffff`               | `#1b1b1b`               | Raised content surface                  |
| `cardForeground`        | `--card-foreground`        | `#262626`               | `#f5f5f5`               | Text on `card`                          |
| `popover`               | `--popover`                | `#ffffff`               | `#1b1b1b`               | Sheets, menus, dialogs                  |
| `popoverForeground`     | `--popover-foreground`     | `#262626`               | `#f5f5f5`               | Text on `popover`                       |
| `primary`               | `--primary`                | `#262626`               | `#f5f5f5`               | Filled button, switch on, selected chip |
| `primaryForeground`     | `--primary-foreground`     | `#fafafa` (neutral-50)  | `#262626`               | Text on `primary`                       |
| `secondary`             | `--secondary`              | `#0000000a` (black 4%)  | `#ffffff0a` (white 4%)  | Quiet fill                              |
| `secondaryForeground`   | `--secondary-foreground`   | `#262626`               | `#f5f5f5`               | Text on `secondary`                     |
| `muted`                 | `--muted`                  | `#0000000a`             | `#ffffff0a`             | Skeletons, inert fills                  |
| `mutedForeground`       | `--muted-foreground`       | `#686868`               | `#818181`               | Secondary text, captions                |
| `accent`                | `--accent`                 | `#0000000a`             | `#ffffff0a`             | Hover / pressed wash                    |
| `accentForeground`      | `--accent-foreground`      | `#262626`               | `#f5f5f5`               | Text on `accent`                        |
| `destructive`           | `--destructive`            | `#fb2c36` (red-500)     | `#fb414a`               | Destructive fill, error icon            |
| `destructiveForeground` | `--destructive-foreground` | `#c10007` (red-700)     | `#ff6467` (red-400)     | Error _text_ on a normal surface        |
| `success`               | `--success`                | `#00bc7d` (emerald-500) | `#00bc7d`               | Success fill / icon                     |
| `successForeground`     | `--success-foreground`     | `#007a55` (emerald-700) | `#00d492` (emerald-400) | Success text                            |
| `warning`               | `--warning`                | `#fe9a00` (amber-500)   | `#fe9a00`               | Warning fill / icon                     |
| `warningForeground`     | `--warning-foreground`     | `#bb4d00` (amber-700)   | `#ffb900` (amber-400)   | Warning text                            |
| `info`                  | `--info`                   | `#2b7fff` (blue-500)    | `#2b7fff`               | Info fill / icon                        |
| `infoForeground`        | `--info-foreground`        | `#1447e6` (blue-700)    | `#51a2ff` (blue-400)    | Info text                               |
| `border`                | `--border`                 | `#00000014` (black 8%)  | `#ffffff0f` (white 6%)  | Hairlines, dividers                     |
| `input`                 | `--input`                  | `#0000001a` (black 10%) | `#ffffff14` (white 8%)  | Control borders, switch off             |
| `ring`                  | `--ring`                   | `#a1a1a1` (neutral-400) | `#737373` (neutral-500) | Focus ring                              |

Mobile-only additions. Web has no camera, and expresses the third as a literal
`text-white` rather than a variable:

| Token        | Light       | Dark        | Use                                 |
| ------------ | ----------- | ----------- | ----------------------------------- |
| `scrim`      | `#00000099` | `#000000b3` | Camera overlay, media chrome        |
| `onScrim`    | `#ffffff`   | `#ffffff`   | Text/icons over `scrim`             |
| `onStatus`   | `#ffffff`   | `#ffffff`   | Text/icons on a `destructive` fill  |
| `viewfinder` | `#000000`   | `#000000`   | Letterbox behind a live camera feed |

None of these flip with the appearance, and that is the point. `onStatus` exists
because `background` is near-black in dark mode, and dark text on a red fill
reads as a warning chip rather than a button. `viewfinder` is the absence of an
image, not a surface.

Two derived helpers exist instead of extra tokens:

- `alpha(token, fraction)` — the mobile equivalent of Tailwind's `/nn` opacity
  suffix, e.g. `alpha(destructive, 0.08)` mirrors `bg-destructive/8`.
- Status surfaces use exactly the coss Alert recipe: fill
  `alpha(status, 0.06)`, border `alpha(status, 0.32)`, icon `status`, title
  `foreground`, body `mutedForeground`.

### 2.2 Banned

These break the "same product on every platform" rule and must never appear:

- ❌ `Color.android.dynamic.*` — Material You derives from the user's wallpaper.
  A wallpaper is not our brand.
- ❌ `Color.android.holo_*` — a deprecated 2011 palette.
- ❌ `Color.ios.systemBlue` / `systemPurple` / `systemGreen` … used as brand,
  accent or primary. iOS semantic _greys_ are also out: they don't match
  `neutral-800` / `neutral-100`.
- ❌ Any raw hex or `rgba()` in a component file.
- ❌ Material `primaryContainer` / `tertiaryContainer` / `secondaryContainer`
  tinted icon chips as decoration.

Instead: `Host seedColor={primary}` on every `@expo/ui` host. On Android that
generates a neutral Material 3 palette (`SchemeTonalSpot` from our neutral seed)
for anything Compose paints implicitly — ripples, chips, indicators, search bar.
On iOS the same prop becomes the SwiftUI tint, so native controls stop being
blue. Everything else is painted explicitly from the token table.

Native views outside an `@expo/ui` host have no seed to inherit, so they need
every tint named. `NativeTabs` is the one that matters: left alone it is
systemBlue on iOS and wallpaper-derived on Android, so `tintColor`, `iconColor`,
`indicatorColor`, `rippleColor` and the label colors are all set from the
palette. The same goes for React Navigation's theme, which ships iOS blue as
`primary` and is rebuilt from the palette in `app/_layout.tsx`.

### 2.3 Dark mode

Follows the device; there is no in-app toggle
(`apps/mobile/src/theme/appearance.ts` calls `Appearance.setColorScheme("unspecified")`).
Every `@expo/ui` `Host` receives `colorScheme` so the native subtree flips with
the JS tree instead of one frame later.

---

## 3. Typography

- **Sans:** Inter. `Inter_400Regular` and `Inter_500Medium` on mobile,
  `"Inter Variable"` via `@fontsource-variable/inter` on web.
- **Mono:** Geist Mono (`GeistMono_400Regular`, `GeistMono_500Medium`;
  `"Geist Mono Variable"` on web). Code, IDs, prices, counts — anything that
  should align in a column. JetBrains Mono is the accepted alternative where a
  package already ships it.
- **Weights:** 400 and 500 only. 500 is the maximum. No semibold, no bold.
- **Scale:** 12 / 14 / 16 / 18 / 24. Body is 14, small is 12. Nothing else.
  Do not introduce 20, 22 or anything ≥ 28.

| Role       | Size / line height | Weight | Web utility | Mobile variant |
| ---------- | ------------------ | ------ | ----------- | -------------- |
| Title      | 24 / 30            | 500    | `text-2xl`  | `title`        |
| Heading    | 18 / 26            | 500    | `text-lg`   | `heading`      |
| Subheading | 16 / 24            | 500    | `text-base` | `subheading`   |
| Body       | 14 / 20            | 400    | `text-sm`   | `body`         |
| Body med.  | 14 / 20            | 500    | `text-sm`   | `bodyMedium`   |
| Caption    | 12 / 16            | 400    | `text-xs`   | `caption`      |
| Label      | 12 / 16            | 500    | `text-xs`   | `label`        |
| Mono       | 14 / 20            | 400    | `font-mono` | `mono`         |

Rules: sentence case everywhere. No `textTransform: "uppercase"` and no
letter-spaced micro-labels — they read as marketing chrome. Tabular numerals
(`fontVariant: ["tabular-nums"]`) on anything that changes in place.

---

## 4. Radius, spacing, density

### Radius

`--radius: 0.625rem` (10 px) is the base. The scale is multiplicative and
matches `apps/web/src/styles.css`:

| Name   | Formula        | px  | Use                            |
| ------ | -------------- | --- | ------------------------------ |
| `sm`   | `radius * 0.6` | 6   | Badges, chips-in-text          |
| `md`   | `radius * 0.8` | 8   | Small buttons, inline controls |
| `lg`   | `radius`       | 10  | Buttons, inputs, list rows     |
| `xl`   | `radius * 1.4` | 14  | Cards, alerts                  |
| `2xl`  | `radius * 1.8` | 18  | Sheets, camera viewfinder      |
| `3xl`  | `radius * 2.2` | 22  | Full-bleed media               |
| `full` | —              | 999 | Pills, avatars, FABs           |

React Native must set `borderCurve: "continuous"` wherever it sets
`borderRadius`.

### Spacing

4 px base: 2, 4, 6, 8, 12, 16, 20, 24, 32, 48.

- Screen gutter: **16**.
- Between fields in a form: **12**. Between form sections: **24**.
- Inside a card: **16** padding, **12** gap.
- Between list rows: **0** (hairline separator instead).
- Use `gap` on the parent. Never margin on children.

### Density and hit targets

| Element                        | Height             |
| ------------------------------ | ------------------ |
| Primary / default button       | 48                 |
| Small button                   | 40                 |
| Icon button                    | 40 (44 hit target) |
| Input (single line)            | 48                 |
| List row (single line)         | 48                 |
| List row (two lines)           | 64                 |
| Product row (avatar + 2 lines) | 68                 |

Minimum touch target is 44 × 44 — extend with `hitSlop`, not with padding that
inflates the visual box.

### Borders and elevation

Hairline `border` on the same surface; never a shadow to signal grouping. The
only shadows in the product are the FAB and native sheets, both platform
defaults. Where web uses `shadow-xs/5` + a 1 px inset highlight, mobile uses a
1 px `border`/`input` hairline — the same edge without a fake light source.

### Motion

- Press: scale `0.97`, 120 ms, `cubic-bezier(0.23, 1, 0.32, 1)`.
- Enter / step change: fade + 8 px rise, 200 ms.
- Reduced motion: dim to `0.72` opacity instead of scaling; honour
  `useReducedMotion()` / `ReduceMotion.System`.
- Animate `transform` and `opacity` only. Never height, width or margin.
- Press state lives in a Reanimated shared value (`pressed`: 0 → 1); the scale is
  `interpolate`d from it, so pressing never triggers a React render.

---

## 5. Component recipes

Each recipe lists the coss anatomy, then how web/desktop and mobile realise it.
Mobile primitives live in `apps/mobile/src/components/ui/`.

That directory is the mobile end of this document, the same way
`apps/web/src/components/ui` is the web end. A recipe below with no caller yet
(`Switch`, `FieldError` at the time of writing) is inventory, not dead code —
the point of a design system is that the next screen doesn't have to invent one.

### Button

coss: `Button` with `variant` × `size`, `loading`, and inline icons.

| Variant       | Fill                           | Text                  | Border        |
| ------------- | ------------------------------ | --------------------- | ------------- |
| `default`     | `primary`                      | `primaryForeground`   | `primary`     |
| `outline`     | `card`                         | `foreground`          | `input`       |
| `ghost`       | transparent → `accent` pressed | `foreground`          | none          |
| `secondary`   | `secondary`                    | `secondaryForeground` | none          |
| `destructive` | `destructive`                  | `onStatus` (white)    | `destructive` |
| `link`        | none                           | `foreground`          | none          |

Sizes: `default` 48, `sm` 40, `icon` 40 square. Radius `lg` (`md` for `sm`).
Disabled is `opacity: 0.64` — never a different color. `loading` swaps the label
for a spinner in the label's color and keeps the width.

Mobile is a **compound** component, because a `Pressable` is not a text node:

```tsx
<Button variant="outline" size="sm" onPress={retry}>
  <ButtonIcon name="refresh" />
  <ButtonText>Retry</ButtonText>
</Button>
```

`ButtonIcon` takes a name from the shared `ui/icon` set (§7), not a platform
symbol name — the label and the glyph are drawn by the same renderer.

No boolean props like `isPrimary` / `isDanger`. One `variant` union.

### Field + Input

coss: `Field` → `FieldLabel`, control, `FieldDescription`, `FieldError`.

- `Field`: column, `gap: 8`.
- `FieldLabel`: `label` type, `foreground`.
- `FieldDescription`: `caption`, `mutedForeground`.
- `FieldError`: `caption`, `destructiveForeground` (not `destructive` — text
  needs the darker/lighter end for contrast).
- `Input`: height 48, radius `lg`, 1 px `input` border, `card` fill,
  `foreground` text, `mutedForeground` placeholder. Focused: border `ring`.
  Invalid: border `alpha(destructive, 0.4)`. Selection/cursor colour is
  `foreground`, never the platform accent.

```tsx
<Field>
  <FieldLabel>Email</FieldLabel>
  <Input value={email} onChangeText={setEmail} />
  <FieldError>Enter a valid email.</FieldError>
</Field>
```

### Alert

coss: `Alert` / `AlertTitle` / `AlertDescription` / `AlertAction`, variants
`default | error | success | warning | info`.

Surface `alpha(status, 0.06)`, border `alpha(status, 0.32)`, radius `xl`,
padding 14/12, `gap: 8`. Leading dot or icon in `status`. Title `bodyMedium`
`foreground`; description `caption` `mutedForeground`; action is a `ghost` or
`outline` `sm` button in `AlertAction`. `default` has no tint — just `border`.

### Badge

coss: `Badge` with `variant` and `size`. Because a badge _is_ a text node, mobile
implements it as a styled `Text` and accepts a string child.

| Variant     | Fill                      | Text                    |
| ----------- | ------------------------- | ----------------------- |
| `default`   | `primary`                 | `primaryForeground`     |
| `secondary` | `secondary`               | `secondaryForeground`   |
| `outline`   | `card` + `input` border   | `foreground`            |
| `error`     | `alpha(destructive, 0.1)` | `destructiveForeground` |
| `warning`   | `alpha(warning, 0.12)`    | `warningForeground`     |
| `success`   | `alpha(success, 0.12)`    | `successForeground`     |

Radius `sm`, height 20, `label` type. Badges label, they do not shout: no pill
radius, no uppercase.

### Switch

coss: track `primary` when checked, `input` when unchecked; thumb `background`.
Mobile uses the platform `Switch` with exactly those three colors, so the
gesture, size and animation stay native while the color is ours.

### Tabs

Web/desktop: coss `Tabs` — `ghost`-weight triggers, `foreground` when active,
`mutedForeground` otherwise, 2 px `primary` indicator.

Mobile: `expo-router` `NativeTabs` — a real `UITabBar` on iOS, a Material
navigation bar on Android, one component for both. Painted as: `tintColor`
`foreground` (this is what replaces systemBlue and Material You), icons
`mutedForeground` → `foreground` when selected, labels `caption` 12 with the
same pair, Android indicator and ripple `accent`, hairline `border` — a border,
not an elevation shadow.

The bar's fill differs by platform because the two toolkits differ: iOS keeps
the `systemChromeMaterial` blur so a list stays visible scrolling under it,
while Android, which has no blur material, takes an opaque `card`. A blur is a
translucency rather than a hue, so it adds no color the palette didn't pick.

Selection reads differently too, and should. iOS swaps each outline SF Symbol
for its filled twin; Material has no filled twin for two of the three glyphs, so
Android carries selection in the indicator and icon color, which is Material's
own idiom. Same palette, each platform's grammar.

Two things not to do. Don't draw the tab bar yourself — no floating pill, no
Compose toolbar over a hidden `NativeTabs`, no JS fallback. And don't animate a
tab change: selecting a tab is a switch, not a push, so the root screen of each
tab stack sets `animation: "none"`.

### List

Web/desktop: coss `Table` for data, `Card` + `Separator` for settings groups.

Mobile:

- Grouped settings and summaries → `RowGroup` + `Row`: one bordered `card`
  surface with hairline separators, the same shape the web builds from `Card` +
  `Separator`. Not `@expo/ui` `List`/`ListItem` — see §6.3 for why.
- Long catalogs → `FlashList` with a token-painted `ProductRow` taking
  primitives only.
- Section header: `label` type, `mutedForeground`, sentence case, 16 gutter.
- Rows separate with a hairline `border` inset past the leading slot.
- The chevron is an explicit `RowChevron` in the trailing slot, not something
  inferred from `onPress`. A row that reveals a value is tappable and goes
  nowhere; it must not promise a screen.

### Sheet

Web/desktop: coss `Sheet` / `Drawer` (`popover` surface, `ghost` close button in
the footer).

Mobile: native `Modal` with `presentationStyle="formSheet"` (iOS) /
`"pageSheet"` (Android) — not a JS bottom sheet. Surface `popover`, radius
`2xl`, 24 padding, title `heading`, body `body`/`mutedForeground`, actions
stacked with the confirm as `default` and the dismiss as `ghost`.

### Card

`card` fill, 1 px `border`, radius `xl`, `overflow: hidden`. Slots:
`CardHeader` (16 padding, 4 gap), `CardTitle` (`subheading`), `CardDescription`
(`caption` `mutedForeground`), `CardContent` (16 padding, 12 gap), `CardFooter`.

### Empty state

coss `Empty` anatomy, one to one:

```tsx
<Empty>
  <EmptyMedia name="shippingbox" />
  <EmptyTitle>No products yet</EmptyTitle>
  <EmptyDescription>Create one, or scan a label.</EmptyDescription>
  <EmptyContent>
    <Button variant="outline">…</Button>
  </EmptyContent>
</Empty>
```

`EmptyMedia` is a 40 px `secondary` square with radius `lg` holding a
`mutedForeground` icon — not a big illustration. Centered, `gap: 8`, 48 vertical
padding, at most one action.

### Separator / Spinner / Chip

- `Separator`: 1 hairline of `border`, optional leading inset.
- `Spinner`: platform indicator in `foreground` (or `mutedForeground` when it
  sits beside secondary copy). No branded loader.
- `Chip` (filter): height 32, radius `full`, `secondary` fill →
  `primary`/`primaryForeground` when selected, `label` type. Selection is the
  only state that changes color.

---

## 6. Mobile structure rules

1. Every `@expo/ui` tree is wrapped in `Host` with `colorScheme` **and**
   `seedColor={primary}`. Missing `seedColor` is how wallpaper color leaks in.
2. `@expo/ui/jetpack-compose` imports only in `*.android.tsx`;
   `@expo/ui/swift-ui` only in `*.ios.tsx`. `Host` always comes from `@expo/ui`.
3. **Native where the platform owns the interaction; shared everywhere else.**
   Native structure is used for navigation chrome (`NativeTabs` and native
   stacks), headers and large titles, FABs, sheets, switches, pull-to-refresh,
   keyboard handling and the camera. Screen _content_ is drawn by React Native
   from the shared primitives, from one file, so both platforms render the same
   hierarchy by construction.

   This line is drawn from experience: the previous build had a `*.android.tsx`
   twin for every screen, and the twins were what let Material You colors, a
   second type scale and a different information hierarchy into the Android
   build without anyone noticing. A platform split may differ in structure; it
   may never differ in palette, type, radius, copy or hierarchy. If a split
   only changes colors, delete it.

4. Scrolling: `contentInsetAdjustmentBehavior="automatic"` on the root scroller;
   no `SafeAreaView` wrappers, no manual `insets.top` padding on iOS. Let the
   tab bar inset the content itself — iOS insets its first scroll view
   automatically and Android sits the content above the bar, so
   `disableAutomaticContentInsets` should stay off and bottom padding should
   only ever budget for what _we_ draw over the content. See
   `hooks/use-overlay-insets`.
5. Lists: virtualize everything (`FlashList`), pass primitives to rows, keep
   rows free of queries and context, hoist callbacks to the list root.
6. Never store scroll or press position in `useState`.
7. React Compiler is enabled (`app.json` → `experiments.reactCompiler`), so skip
   manual `memo`/`useCallback`, destructure functions from hooks at the top of
   render, and use `.get()` / `.set()` on shared values.
8. `Pressable`, never `TouchableOpacity`.
9. Mobile is auth-required. There is no guest inventory and no unauthenticated
   surface other than the auth flow itself.

---

## 7. Icons

- **Web / desktop:** Hugeicons — `<HugeiconsIcon icon={…} />` from
  `@hugeicons/react` with `@hugeicons/core-free-icons`. No numeric `size` prop;
  size via `size-*` utilities. Decorative icons get `aria-hidden="true"`.
- **Mobile:** split by who draws the pixel.
  - _Native chrome_ — tab bars, FABs — uses platform symbols, because the
    platform owns the container and the symbol is what makes it feel native: SF
    Symbols on iOS (`sf={{ default, selected }}`), Material Symbols on Android
    (`md="…"`, glyph names from `expo-symbols`). Compose components that take a
    drawable instead read vector XML from `src/assets/icons`. Keep that
    directory to the drawables something actually imports; an unreferenced one
    still ships in the APK.
  - _Everything React Native draws_ uses the shared `ui/icon` set: one stroke
    family on a 24 grid at 1.5 weight, so a row on Android and the same row on
    iOS are identical and match the Hugeicons weight on web.
- Either way the metrics are the same: **20 px** inline, **24 px** in a list
  leading slot, tinted `foreground` or `mutedForeground`, never a platform
  accent. Icons never carry information the label doesn't.
- One icon per row maximum. Tinted icon chips as decoration are out.

---

## 8. Review checklist

Before shipping UI in any client:

- [ ] Every color comes from a semantic token; no hex, no `rgba()`, no
      `Color.android.dynamic.*`, no `Color.ios.system*` as brand.
- [ ] `primary` is neutral. If something is blue, it is `info` and it means
      "information".
- [ ] Font sizes are in {12, 14, 16, 18, 24}; weights in {400, 500}.
- [ ] Radius comes from the scale, and `borderCurve: "continuous"` accompanies
      it on native.
- [ ] Spacing is `gap` on parents, screen gutter 16.
- [ ] One filled button per screen region; the rest `outline`/`ghost`.
- [ ] Variant unions instead of boolean props; compound parts instead of
      polymorphic children.
- [ ] Empty, loading and error states exist and use `Empty` / `Spinner` /
      `Alert`.
- [ ] Touch targets ≥ 44; reduced motion respected.
- [ ] Android and iOS screenshots read as the same product as the web app.
