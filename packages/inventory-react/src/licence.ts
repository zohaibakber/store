import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { LicenceState } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as Stream from "effect/Stream";

import { causeSurface, InventoryCommandError } from "./errors";
import { Desktop } from "./services";

const licenceState = Desktop.runtime
  .atom(Stream.unwrap(Desktop.use((desktop) => Effect.succeed(desktop("LicenceState", undefined)))))
  .pipe(Atom.keepAlive);

const enterLicence = Desktop.runtime.fn<string>()((text) =>
  Desktop.use((desktop) => desktop("EnterLicence", { text })),
);

export const useLicenceState = (): LicenceState | undefined =>
  AsyncResult.getOrElse(useAtomValue(licenceState), () => undefined);

export const useEnterLicence = () => {
  const enter = useAtomSet(enterLicence, { mode: "promiseExit" });
  return async (text: string) => {
    const exit = await enter(text);
    if (Exit.isFailure(exit)) throw new InventoryCommandError(causeSurface(exit.cause));
    return exit.value;
  };
};
