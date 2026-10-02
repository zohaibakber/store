import { effectLayer } from "@sentry/effect/server";
import * as Layer from "effect/Layer";

import { sentryOptions } from "./sentry-options";

export const layerWorkerSentry = Layer.suspend(() => {
  const options = sentryOptions();
  if (!options) return Layer.empty;
  return effectLayer({
    ...options,
    integrations: (defaults) =>
      defaults.filter((integration) => integration.name !== "ProcessSession"),
  });
});
