import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { LicenceState } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as Stream from "effect/Stream";

import { Desktop } from "./services";

const licenceState = Desktop.runtime
  .atom(Stream.unwrap(Desktop.use((desktop) => Effect.succeed(desktop("LicenceState", undefined)))))
  .pipe(Atom.keepAlive);

const enterLicence = Desktop.mutation("EnterLicence");

export const useLicenceState = (): LicenceState | undefined =>
  AsyncResult.getOrElse(useAtomValue(licenceState), () => undefined);

export const useEnterLicence = () => {
  const enter = useAtomSet(enterLicence, { mode: "promiseExit" });
  return (text: string) => enter({ payload: { text } });
};
