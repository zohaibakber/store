---
name: vercel-composition-patterns
description: Refactor React component APIs with tangled variants, shared state, or compound composition.
license: MIT
metadata:
  author: vercel
  version: "1.0.0"
---

# React composition

Choose a composition that simplifies the actual callers. A boolean is reasonable for a binary state; use explicit variants or compound components when independent mode flags create invalid combinations. Preserve public behavior unless the task changes it.

Read the relevant rule for examples:

- Variant complexity: [boolean modes](rules/architecture-avoid-boolean-props.md) and [explicit variants](rules/patterns-explicit-variants.md).
- Shared component internals: [compound components](rules/architecture-compound-components.md).
- State ownership: [lift state](rules/state-lift-state.md) and [decouple implementation](rules/state-decouple-implementation.md).
- Interchangeable state providers: [context interface](rules/state-context-interface.md).
- Content slots: [children and render props](rules/patterns-children-over-render-props.md).
- React 19 migrations only: [refs and context](rules/react19-no-forwardref.md).

Treat examples as design options. Introducing a provider, replacing render props, or migrating React APIs should serve the requested change. The compiled `AGENTS.md` duplicates these rules and is only needed for a full review.
