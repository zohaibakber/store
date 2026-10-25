import { defineRule } from "vite-plus/lint/plugins";

import { importsEffect, isGlobalName, staticPropertyName } from "../shared/effect-source.ts";

/** Ban the global crypto object in Effect files; the Crypto service is the seam. */
export const noGlobalCryptoRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow the global crypto object in files that import effect; use the Crypto service so tests can replace it.",
    },
    messages: {
      crypto:
        "Use `yield* Crypto.Crypto` (or a service that wraps it) instead of the global `crypto`, so randomness and hashing stay replaceable.",
    },
  },
  createOnce(context) {
    let usesEffect = false;
    return {
      Program(node) {
        usesEffect = importsEffect(node);
      },
      MemberExpression(node) {
        if (!usesEffect) return;
        if (isGlobalName(context.sourceCode, node.object, "crypto")) {
          context.report({ node, messageId: "crypto" });
          return;
        }
        if (isGlobalName(context.sourceCode, node.object, "globalThis") && staticPropertyName(node) === "crypto") {
          context.report({ node, messageId: "crypto" });
        }
      },
    };
  },
});
