import { defineRule } from "vite-plus/lint/plugins";

import { isEffectCall } from "../shared/effect-source.ts";

/** Ban yield* Effect.fail(new X(...)); a tagged error is yieldable itself. */
export const noYieldEffectFailRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow `yield* Effect.fail(new X(...))`; yield the error directly.",
    },
    messages: {
      fail: "Write `return yield* new X({...})`. Tagged errors are yieldable, so `Effect.fail` only adds a wrapper.",
    },
  },
  createOnce(context) {
    return {
      YieldExpression(node) {
        const argument = node.argument;
        if (!node.delegate || argument?.type !== "CallExpression") return;
        if (!isEffectCall(argument, (name) => name === "fail")) return;
        const failure = argument.arguments[0];
        if (failure?.type === "NewExpression" || failure?.type === "CallExpression") {
          context.report({ node, messageId: "fail" });
        }
      },
    };
  },
});
