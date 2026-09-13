---
name: coss
description: Implement or troubleshoot COSS components and migrate Radix composition to Base UI.
compatibility: Requires Tailwind CSS v4 and @base-ui/react. Designed for React projects using the coss component registry.
license: MIT
metadata:
  author: cosscom
---

# COSS UI

Use the installed components and their types as the source of truth for imports, props, and composition. Preserve the project's typography, icons, and registry conventions when adapting upstream examples.

Trigger and popup hierarchies differ between primitives. Check the relevant guide when composing overlays or migrating from Radix; keep accessible labels, focus behavior, and field error semantics intact.

## References by task

- Component lookup: [registry](references/component-registry.md), then the matching `references/primitives/<name>.md`.
- Forms: [field and validation patterns](references/rules/forms.md).
- Overlays and grouped controls: [composition](references/rules/composition.md).
- Radix migration: [migration patterns](references/rules/migration.md).
- Tokens and selectors: [styling](references/rules/styling.md).
- Portal containers or mounting: [portal props](references/portal-props.md).
- Adding missing components: [CLI and manual installation](references/cli.md).
- A composed example when useful: [particle catalog](../coss-particles/SKILL.md).

Upstream docs are at <https://coss.com/ui/llms.txt>. Paths under `apps/ui/` in references describe the upstream COSS repository.
