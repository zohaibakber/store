import { defineRule } from "vite-plus/lint/plugins";

import { isNamespaceMember } from "../shared/effect-source.ts";

/** Require Schema.TaggedStruct for a struct with a literal _tag field. */
export const preferTaggedStructRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow `Schema.Struct({ _tag: Schema.Literal(...) })`; use `Schema.TaggedStruct`.",
    },
    messages: {
      tagged: "Use `Schema.TaggedStruct(tag, fields)` instead of a `_tag: Schema.Literal(...)` field.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (!isNamespaceMember(node.callee, "Schema", (name) => name === "Struct")) return;
        const fields = node.arguments[0];
        if (fields?.type !== "ObjectExpression") return;
        for (const property of fields.properties) {
          if (property.type !== "Property" || property.computed) continue;
          const key = property.key;
          const named = key.type === "Identifier" ? key.name : key.type === "Literal" ? key.value : null;
          if (named !== "_tag") continue;
          const value = property.value;
          if (
            value.type === "CallExpression" &&
            isNamespaceMember(value.callee, "Schema", (name) => name === "Literal") &&
            value.arguments[0]?.type === "Literal"
          ) {
            context.report({ node: property, messageId: "tagged" });
          }
        }
      },
    };
  },
});
