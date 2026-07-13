import { createFactory } from "hono/factory";
import type { AppEnv } from "./auth-client";

export const factory = createFactory<AppEnv>();
