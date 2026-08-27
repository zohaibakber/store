import { expect, test } from "vitest";

import { resolveDesktopRuntimeDependencies } from "../../scripts/stage-runtime-modules";

test("desktop runtime staging keeps updater packages and drops Electron plus workspace specs", () => {
  expect(
    resolveDesktopRuntimeDependencies({
      electron: "43.4.1",
      "electron-updater": "^6.8.9",
      "electron-squirrel-startup": "^1.0.1",
      "@store/auth": "workspace:*",
    }),
  ).toEqual({
    "electron-updater": "^6.8.9",
    "electron-squirrel-startup": "^1.0.1",
  });
});
