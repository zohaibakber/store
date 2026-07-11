<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Typography

These rules apply to all UI work in `apps/desktop`. The tokens enforcing them
live in `apps/desktop/src/styles.css` (Tailwind v4 `@theme` block).

- **Font**: Inter (`"Inter Variable"`, loaded via `@fontsource-variable/inter`).
  Geist Mono for code only.
- **Weights**: regular (400) and medium (500) only — medium is the maximum.
  Never use `font-semibold` or `font-bold`; the theme clamps both to 500, so
  reaching for them is always a mistake.
- **Font sizes**: 12px and 14px are the base sizes (body text is 14px, small
  text is 12px). The full scale is 12 / 14 / 16 / 18 / 24, and 24px is the
  biggest — nothing renders larger. Use Tailwind utilities: `text-xs` (12),
  `text-sm` (14, body default), `text-base` (16), `text-lg` (18), `text-2xl`
  (24). `text-xl` and `text-3xl`+ are clamped into the scale; don't introduce
  new sizes.
- **Icons**: Lucide icons use a 1.2 stroke width, applied globally via the
  `.lucide` rule in `styles.css` — don't pass a `strokeWidth` prop.
