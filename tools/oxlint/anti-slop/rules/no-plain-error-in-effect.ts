import { defineRule } from "vite-plus/lint/plugins";

import type { ESTree } from "vite-plus/lint/plugins";

import { importsEffect, isEffectCall } from "../shared/effect-source.ts";

const plainErrors = new Set(["Error", "TypeError", "RangeError"]);

/** Ban plain Error values in Effect files; failures are tagged errors. */
export const noPlainErrorInEffectRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow new Error, extends Error and Effect.fail with an object literal in files that import effect.",
    },
    messages: {
      plain:
        "Do not construct a plain `Error`. Declare a `Schema.TaggedError` for this failure and raise it with `return yield* new X({...})`.",
      subclass:
        "Do not extend `Error`. Declare a `Schema.TaggedError` so the failure is typed in the error channel.",
      literal:
        "Do not fail with an object literal. Declare a `Schema.TaggedError` and raise it with `return yield* new X({...})`.",
    },
  },
  createOnce(context) {
    let usesEffect = false;
    const checkClass = (node: ESTree.Class) => {
      if (!usesEffect) return;
      if (node.superClass?.type === "Identifier" && node.superClass.name === "Error") {
        context.report({ node, messageId: "subclass" });
      }
    };
    return {
      Program(node) {
        usesEffect = importsEffect(node);
      },
      NewExpression(node) {
        if (!usesEffect) return;
        if (node.callee.type === "Identifier" && plainErrors.has(node.callee.name)) {
          context.report({ node, messageId: "plain" });
        }
      },
      CallExpression(node) {
        if (!usesEffect) return;
        const argument = node.arguments[0];
        if (isEffectCall(node, (name) => name === "fail") && argument?.type === "ObjectExpression") {
          context.report({ node, messageId: "literal" });
        }
      },
      ClassDeclaration: checkClass,
      ClassExpression: checkClass,
    };
  },
});
