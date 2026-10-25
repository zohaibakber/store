import { defineRule } from "vite-plus/lint/plugins";

import { staticPropertyName } from "../shared/effect-source.ts";

const discriminants = new Set(["_tag", "code"]);

/** Ban default clauses in switches over a discriminant. */
export const noAbsorbingDefaultOnTagRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a default clause in a switch over `x._tag` or `x.code`; list every case so a new variant fails to compile.",
    },
    messages: {
      absorbing:
        "Remove `default`. List every case and end with `x satisfies never`, so adding a variant is a compile error instead of a silent fallthrough.",
    },
  },
  createOnce(context) {
    return {
      SwitchStatement(node) {
        const name = staticPropertyName(node.discriminant);
        if (name === null || !discriminants.has(name)) return;
        for (const switchCase of node.cases) {
          if (switchCase.test === null) context.report({ node: switchCase, messageId: "absorbing" });
        }
      },
    };
  },
});
