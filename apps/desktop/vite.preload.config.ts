import type { ConfigEnv, UserConfig } from "vite";
import { defineConfig, mergeConfig } from "vite";

import {
  external,
  getBuildConfig,
  pluginHotRestart,
  rendererDefines,
} from "./vite.base.config.js";

export default defineConfig((env) => {
  const forgeEnv = env as ConfigEnv<"build">;
  const { forgeConfigSelf } = forgeEnv;
  const config: UserConfig = {
    build: {
      rollupOptions: {
        external,
        input: forgeConfigSelf.entry!,
        output: {
          format: "cjs",
          inlineDynamicImports: true,
          entryFileNames: "preload.cjs",
          chunkFileNames: "[name].cjs",
          assetFileNames: "[name].[ext]",
        },
      },
    },
    define: {
      ...rendererDefines,
      "import.meta.env.PROD": JSON.stringify(forgeEnv.command === "build"),
    },
    plugins: [pluginHotRestart("reload")],
  };

  return mergeConfig(getBuildConfig(forgeEnv), config);
});
