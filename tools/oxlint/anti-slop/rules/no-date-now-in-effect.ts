import { defineRule } from "vite-plus/lint/plugins";

import { importsEffect, isGlobalName, isNamespaceMember } from "../shared/effect-source.ts";

/** Ban ambient clocks, randomness and timers in Effect files. */
export const noDateNowInEffectRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Date.now, new Date(), Math.random, setTimeout and setInterval in files that import effect.",
    },
    messages: {
      now: "Read time through `Clock` (`Clock.currentTimeMillis`, `DateTime.now`), not `Date.now()` or `new Date()`.",
      random: "Draw randomness through `Random`, not `Math.random()`.",
      timer:
        "Schedule through Effect (`Effect.sleep`, `Schedule`, `Effect.timeout`), not `setTimeout` or `setInterval`.",
    },
  },
  createOnce(context) {
    let usesEffect = false;
    return {
      Program(node) {
        usesEffect = importsEffect(node);
      },
      CallExpression(node) {
        if (!usesEffect) return;
        const { callee } = node;
        if (
          isNamespaceMember(callee, "Date", (name) => name === "now") &&
          callee.type === "MemberExpression" &&
          isGlobalName(context.sourceCode, callee.object, "Date")
        ) {
          context.report({ node, messageId: "now" });
          return;
        }
        if (
          isNamespaceMember(callee, "Math", (name) => name === "random") &&
          callee.type === "MemberExpression" &&
          isGlobalName(context.sourceCode, callee.object, "Math")
        ) {
          context.report({ node, messageId: "random" });
          return;
        }
        if (
          callee.type === "Identifier" &&
          (callee.name === "setTimeout" || callee.name === "setInterval") &&
          isGlobalName(context.sourceCode, callee, callee.name)
        ) {
          context.report({ node, messageId: "timer" });
        }
      },
      NewExpression(node) {
        if (!usesEffect) return;
        if (
          node.arguments.length === 0 &&
          node.callee.type === "Identifier" &&
          isGlobalName(context.sourceCode, node.callee, "Date")
        ) {
          context.report({ node, messageId: "now" });
        }
      },
    };
  },
});
