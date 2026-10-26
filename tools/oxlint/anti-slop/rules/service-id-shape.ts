import { defineRule } from "vite-plus/lint/plugins";

import { isNamespaceMember } from "../shared/effect-source.ts";

const serviceId = /^@store\/[a-z][a-z0-9-]*\/[A-Z][A-Za-z0-9]*(\.[A-Z][A-Za-z0-9]*)*$/;

/** Require Context.Service ids to follow `@store/<package>/<Name>`. */
export const serviceIdShapeRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Require Context.Service ids of the form `@store/<package>/<Name>`.",
    },
    messages: {
      shape:
        "Service id `{{id}}` must look like `@store/<package>/<Name>` so ids stay unique across packages.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        const isService = (target: typeof callee) =>
          isNamespaceMember(target, "Context", (name) => name === "Service");
        const applied = callee.type === "CallExpression" && isService(callee.callee);
        if (!applied && !isService(callee)) return;
        const id = node.arguments[0];
        if (id?.type !== "Literal" || typeof id.value !== "string" || serviceId.test(id.value)) {
          return;
        }
        context.report({ node: id, messageId: "shape", data: { id: id.value } });
      },
    };
  },
});
