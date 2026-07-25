import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach } from "vitest";

import { StoreProvider, type Store } from "@/lib/store";

import { storeStub } from "./store-stub";

afterEach(cleanup);

export const renderWithStore = (ui: ReactNode, store: Store = storeStub()) =>
  render(<StoreProvider store={store}>{ui}</StoreProvider>);
