import { defineRule } from "vite-plus/lint/plugins";

import { isEffectCall, isNamespaceMember } from "../shared/effect-source.ts";

const runnerPattern = /^run(Sync|SyncExit|Promise|PromiseExit|Fork|Callback|PromiseWith|ForkWith)$/;

/** Ban running effects anywhere except a process edge. */
export const noEffectRunOutsideEdgeRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Effect.run* and ManagedRuntime.make outside the edge files; the edge runs the graph once.",
    },
    messages: {
      run: "Do not run effects here. Return the Effect and let the process edge (worker entry, host facade, Alchemy handler) run it. Edge files are the ones this rule is turned off for in vite.config.ts.",
      runtime:
        "Do not build a ManagedRuntime here. One ManagedRuntime per process is made at the edge file.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (isEffectCall(node, (name) => runnerPattern.test(name))) {
          context.report({ node, messageId: "run" });
          return;
        }
        if (isNamespaceMember(node.callee, "ManagedRuntime", (name) => name === "make")) {
          context.report({ node, messageId: "runtime" });
        }
      },
    };
  },
});
