import { builtinModules } from "node:module";
import type { AddressInfo } from "node:net";
import type { ConfigEnv, Plugin, UserConfig } from "vite";

import pkg from "./package.json";

export const builtins = ["electron", ...builtinModules.flatMap((m) => [m, `node:${m}`])];

export const external = [
  ...builtins,
  ...Object.keys("dependencies" in pkg ? (pkg.dependencies as Record<string, unknown>) : {}),
];

export const rendererDefines = {
  "import.meta.env.VITE_API_URL": JSON.stringify(process.env["VITE_API_URL"] ?? ""),
  "import.meta.env.VITE_AUTH_URL": JSON.stringify(process.env["VITE_AUTH_URL"] ?? ""),
  "import.meta.env.VITE_SENTRY_DSN": JSON.stringify(process.env["VITE_SENTRY_DSN"] ?? ""),
};

export function getBuildConfig(env: ConfigEnv<"build">): UserConfig {
  const { root, mode, command } = env;

  return {
    root,
    mode,
    build: {
      emptyOutDir: false,
      outDir: ".vite/build",
      watch: command === "serve" ? {} : null,
      minify: command === "build",
    },
    clearScreen: false,
  };
}

export function getDefineKeys(names: string[]) {
  const define: { [name: string]: VitePluginRuntimeKeys } = {};

  return names.reduce((acc, name) => {
    const NAME = name.toUpperCase();
    const keys: VitePluginRuntimeKeys = {
      VITE_DEV_SERVER_URL: `${NAME}_VITE_DEV_SERVER_URL`,
      VITE_NAME: `${NAME}_VITE_NAME`,
    };

    return { ...acc, [name]: keys };
  }, define);
}

export function getBuildDefine(env: ConfigEnv<"build">) {
  const { command, forgeConfig } = env;
  const names = (forgeConfig.renderer ?? [])
    .filter(({ name }) => name != null)
    .map(({ name }) => name!);
  const defineKeys = getDefineKeys(names);
  const define = Object.entries(defineKeys).reduce(
    (acc, [name, keys]) => {
      const { VITE_DEV_SERVER_URL, VITE_NAME } = keys;
      const def = {
        [VITE_DEV_SERVER_URL]:
          command === "serve" ? JSON.stringify(process.env[VITE_DEV_SERVER_URL]) : undefined,
        [VITE_NAME]: JSON.stringify(name),
      };
      return { ...acc, ...def };
    },
    {} as Record<string, string | undefined>,
  );

  return define;
}

export function pluginExposeRenderer(name: string): Plugin {
  const keys = getDefineKeys([name])[name];
  if (!keys) throw new Error(`Missing Vite runtime keys for renderer ${name}`);
  const { VITE_DEV_SERVER_URL } = keys;

  return {
    name: "@electron-forge/plugin-vite:expose-renderer",
    configureServer(server) {
      process.viteDevServers ??= {};
      process.viteDevServers[name] = server;

      server.httpServer?.once("listening", () => {
        const addressInfo = server.httpServer!.address() as AddressInfo;
        process.env[VITE_DEV_SERVER_URL] = `http://localhost:${addressInfo?.port}`;
      });
    },
  };
}

export function pluginHotRestart(command: "reload" | "restart"): Plugin {
  return {
    name: "@electron-forge/plugin-vite:hot-restart",
    closeBundle() {
      if (command === "reload") {
        for (const server of Object.values(process.viteDevServers ?? {})) {
          server.ws.send({ type: "full-reload" });
        }
      } else {
        process.stdin.emit("data", "rs");
      }
    },
  };
}
