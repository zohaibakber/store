import { defineRule } from "vite-plus/lint/plugins";

import { importsEffect } from "../shared/effect-source.ts";

const fsModules = new Set(["node:fs", "node:fs/promises", "fs", "fs/promises"]);

/** Ban Node fs imports in Effect files; FileSystem is the seam. */
export const noNodeFsInEffectRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow node:fs imports in files that import effect; use the FileSystem service.",
    },
    messages: {
      fs: "Use `FileSystem.FileSystem` from effect instead of `{{module}}`, so the file access is typed, scoped and replaceable in tests.",
    },
  },
  createOnce(context) {
    let usesEffect = false;
    return {
      Program(node) {
        usesEffect = importsEffect(node);
      },
      ImportDeclaration(node) {
        if (!usesEffect) return;
        const source = node.source.value;
        if (typeof source === "string" && fsModules.has(source)) {
          context.report({ node, messageId: "fs", data: { module: source } });
        }
      },
    };
  },
});
