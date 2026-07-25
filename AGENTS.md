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

These are conventions, not constraints: the `@theme` block defines the font
family, but nothing clamps weights or sizes. Following them is on you.

- **Font**: Inter (`"Inter Variable"`, loaded via `@fontsource-variable/inter`).
  JetBrains Mono (`"JetBrains Mono Variable"`, loaded via
  `@fontsource-variable/jetbrains-mono`) is for code only.
- **Weights**: regular (400) and medium (500) only — medium is the maximum.
  Avoid `font-semibold` and `font-bold`. Nothing prevents them, so a few uses
  have crept in; don't add more.
- **Font sizes**: 12px and 14px are the base sizes (body text is 14px, small
  text is 12px). The scale is 12 / 14 / 16 / 18 / 24. Use Tailwind utilities:
  `text-xs` (12), `text-sm` (14, body default), `text-base` (16), `text-lg`
  (18), `text-2xl` (24). Avoid `text-xl` and `text-3xl`+ and don't introduce
  new sizes.
- **Icons**: Hugeicons, via `<HugeiconsIcon icon={...} />` from
  `@hugeicons/react` with icons from `@hugeicons/core-free-icons`.

## Desktop UI components

`apps/desktop/src/components/ui` is a registry surface managed by
`components.json`, not application code. Primitives there may have no importer
yet — that is inventory, not dead code, so don't delete them for being unused.
