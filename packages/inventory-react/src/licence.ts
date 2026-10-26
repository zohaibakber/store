import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { LicenceState } from "@store/contracts";
import * as Option from "effect/Option";
import * as Atom from "effect/reactivity/Atom";

import { useCatalogReplica, useReadyInventory } from "./provider";

const noLicence = Atom.make(Option.none<LicenceState>());

export const useLicenceState = (): LicenceState | undefined =>
  Option.getOrUndefined(useAtomValue(useReadyInventory()?.inventory.atoms.licence ?? noLicence));

export const useEnterLicence = () => {
  const enter = useAtomSet(useCatalogReplica().commands.enterLicence, { mode: "promiseExit" });
  return (text: string) => enter({ payload: { text } });
};
