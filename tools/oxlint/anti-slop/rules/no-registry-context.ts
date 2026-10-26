import { defineRule } from "vite-plus/lint/plugins";

/** Ban RegistryContext outside the atom provider owner. */
export const noRegistryContextRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow importing RegistryContext from @effect/atom-react; packages/inventory-react owns the atom provider.",
    },
    messages: {
      registryContext:
        "Do not import `RegistryContext`. Read atoms through the hooks and let `@store/inventory-react` own the registry provider.",
    },
  },
  createOnce(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "@effect/atom-react") return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.type === "Identifier" &&
            specifier.imported.name === "RegistryContext"
          ) {
            context.report({ node: specifier, messageId: "registryContext" });
          }
        }
      },
    };
  },
});
