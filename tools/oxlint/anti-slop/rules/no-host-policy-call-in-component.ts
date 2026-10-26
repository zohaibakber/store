import { defineRule } from "vite-plus/lint/plugins";

import type { ESTree } from "vite-plus/lint/plugins";

import { staticPropertyName } from "../shared/effect-source.ts";

const policyMethods = new Set(["workspace", "workspaces", "admit", "inventoryScope"]);
const policyReceivers = new Set(["access", "hostAccess"]);

type FunctionNode =
  | ESTree.ArrowFunctionExpression
  | ESTree.FunctionDeclaration
  | ESTree.FunctionExpression;

function isPolicyReceiver(node: ESTree.Node): boolean {
  if (node.type === "Identifier") return policyReceivers.has(node.name);
  const property = staticPropertyName(node);
  return property !== null && policyReceivers.has(property);
}

function functionName(node: FunctionNode): string | null {
  if (node.type !== "ArrowFunctionExpression" && node.id !== null && node.id !== undefined) {
    return node.id.name;
  }
  const parent = node.parent;
  if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier") {
    return parent.id.name;
  }
  return null;
}

function isRenderName(name: string | null): boolean {
  return name !== null && /^(use[A-Z0-9]|[A-Z])/.test(name);
}

/** Ban calling HostAccessPolicy methods while a component or hook renders; the React Compiler memoizes the result. */
export const noHostPolicyCallInComponentRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow HostAccessPolicy method calls in the body of a React component or hook; they are impure and the React Compiler memoizes render-time calls.",
    },
    messages: {
      renderCall:
        "`access.{{method}}` reads the device workspace record and is not pure. The React Compiler memoizes render-time calls, so the result goes stale. Read it in the workspace session atoms or an event handler.",
    },
  },
  createOnce(context) {
    const stack: Array<boolean> = [];
    const enter = (node: FunctionNode) => {
      stack.push(isRenderName(functionName(node)));
    };
    const exit = () => {
      stack.pop();
    };
    return {
      FunctionDeclaration: enter,
      "FunctionDeclaration:exit": exit,
      FunctionExpression: enter,
      "FunctionExpression:exit": exit,
      ArrowFunctionExpression: enter,
      "ArrowFunctionExpression:exit": exit,
      CallExpression(node) {
        if (stack[stack.length - 1] !== true) return;
        const callee = node.callee;
        if (callee.type !== "MemberExpression") return;
        const method = staticPropertyName(callee);
        if (method === null || !policyMethods.has(method)) return;
        if (!isPolicyReceiver(callee.object)) return;
        context.report({ node, messageId: "renderCall", data: { method } });
      },
    };
  },
});
