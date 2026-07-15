import { createFactory } from "hono/factory";
import type { AppEnv } from "./context";

export const factory = createFactory<AppEnv>();
