import { defineRule } from "vite-plus/lint/plugins";

import { isNamespaceMember } from "../shared/effect-source.ts";

/** Ban Number.isSafeInteger; the Int schema is the check. */
export const noNumberIsSafeIntegerRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow Number.isSafeInteger; use the Int schema filters.",
    },
    messages: {
      safe: "Use `Schema.is(Schema.Int)` (or `PositiveInt`, `Schema.Natural`) so the rule lives in one schema, not in a hand-written check.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (isNamespaceMember(node.callee, "Number", (name) => name === "isSafeInteger")) {
          context.report({ node, messageId: "safe" });
        }
      },
    };
  },
});
