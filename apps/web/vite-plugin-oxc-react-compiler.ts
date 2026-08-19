import { transform } from "oxc-transform-react";
import type { Plugin } from "vite";

const includeId = /\.[jt]sx?(?:\?|$)/;
const excludeId = /\/node_modules\//;
const reactLikeCode = /forwardRef|memo|\b(?:[A-Z]|use[A-Z0-9])/;

/** React Compiler via Oxc, leaving JSX for `@vitejs/plugin-react`. */
export function oxcReactCompiler(): Plugin {
  let sourcemap = true;

  return {
    name: "oxc-react-compiler",
    enforce: "pre",
    config() {
      return {
        optimizeDeps: {
          include: ["react/compiler-runtime"],
        },
      };
    },
    configResolved(config) {
      sourcemap = config.command !== "build" || Boolean(config.build.sourcemap);
    },
    transform: {
      filter: {
        id: { include: includeId, exclude: excludeId },
        code: reactLikeCode,
      },
      async handler(code, id) {
        if (this.environment?.config.consumer === "server") return;

        const result = await transform(id.split("?")[0]!, code, {
          jsx: "preserve",
          reactCompiler: true,
          sourcemap,
        });

        const diagnostics = result.errors.map(
          (error) => `${error.message}${error.codeframe ? `\n${error.codeframe}` : ""}`,
        );

        if (result.fatal) {
          this.error(diagnostics.join("\n\n") || "React Compiler transform failed.");
        }
        for (const diagnostic of diagnostics) {
          this.warn(diagnostic);
        }

        return { code: result.code, map: result.map };
      },
    },
  };
}
