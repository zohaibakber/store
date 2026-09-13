---
name: vercel-react-native-skills
description: Diagnose React Native rendering, list, animation, or native dependency performance issues.
license: MIT
metadata:
  author: vercel
  version: "1.0.0"
---

# React Native performance

Locate the affected rendering or native lifecycle behavior and read the matching rules. Apply optimizations where the workload benefits; keep the existing styling, navigation, and image libraries unless the task calls for a change.

## Reference routing

Search `rules/` by the following prefixes and read matching files:

- `list-performance-`: virtualization, expensive items, image sizing, and stable identities.
- `animation-`: animated properties, derived values, and gesture worklets.
- `react-state-`, `react-compiler-`, `rendering-`: subscriptions, compiler integration, and rendering correctness.
- `ui-`, `navigation-`: measurement, safe areas, native navigation, and platform UI.
- `monorepo-`: native dependency placement and version consistency.
- `fonts-`, `imports-`, `js-hoist-`: fonts, imports, and repeated formatter work.
- `scroll-position-`, `state-ground-truth`: scroll state and authoritative values.
- `design-system-`: shared component composition.

For example, use [virtualization](rules/list-performance-virtualize.md) for long lists and [native dependency placement](rules/monorepo-native-deps-in-app.md) for native linking in a monorepo. The compiled `AGENTS.md` is a full reference, not a prerequisite.

Measure the relevant interaction when optimizing. Memoization, gesture-based presses, and library replacements are conditional options; preserve accessibility and behavior while evaluating them.
