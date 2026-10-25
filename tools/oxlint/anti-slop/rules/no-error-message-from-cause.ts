import { defineRule } from "vite-plus/lint/plugins";

/** Ban the instanceof Error message ternary. */
export const noErrorMessageFromCauseRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow `x instanceof Error ? x.message : ...`; carry the cause on the tagged error instead of flattening it to text.",
    },
    messages: {
      message:
        "Do not flatten a cause with `instanceof Error ? x.message`. Put the cause on a tagged error field and let the boundary that reports it format it.",
    },
  },
  createOnce(context) {
    return {
      ConditionalExpression(node) {
        const { test, consequent } = node;
        if (test.type !== "BinaryExpression" || test.operator !== "instanceof") return;
        if (test.right.type !== "Identifier" || test.right.name !== "Error") return;
        if (test.left.type !== "Identifier") return;
        if (
          consequent.type === "MemberExpression" &&
          consequent.object.type === "Identifier" &&
          consequent.object.name === test.left.name &&
          !consequent.computed &&
          consequent.property.type === "Identifier" &&
          consequent.property.name === "message"
        ) {
          context.report({ node, messageId: "message" });
        }
      },
    };
  },
});
