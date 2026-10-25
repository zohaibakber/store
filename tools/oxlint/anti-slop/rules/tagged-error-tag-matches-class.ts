import { defineRule } from "vite-plus/lint/plugins";

import { isNamespaceMember } from "../shared/effect-source.ts";

import type { ESTree } from "vite-plus/lint/plugins";

/** Require a Schema.TaggedError tag to equal the class name. */
export const taggedErrorTagMatchesClassRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require the tag passed to Schema.TaggedError<X>()(tag, ...) to equal the name of class X.",
    },
    messages: {
      mismatch:
        "The tag `{{tag}}` must equal the class name `{{name}}`. A tag that differs from the class makes `catchTag` and the wire disagree about the error's name.",
    },
  },
  createOnce(context) {
    const check = (node: ESTree.Class) => {
      const name = node.id?.name;
      const base = node.superClass;
      if (name === undefined || base?.type !== "CallExpression") return;
      const factory = base.callee;
      if (factory.type !== "CallExpression") return;
      if (!isNamespaceMember(factory.callee, "Schema", (member) => member === "TaggedError")) return;
      const tag = base.arguments[0];
      if (tag?.type !== "Literal" || typeof tag.value !== "string" || tag.value === name) return;
      context.report({ node: tag, messageId: "mismatch", data: { tag: tag.value, name } });
    };
    return { ClassDeclaration: check, ClassExpression: check };
  },
});
