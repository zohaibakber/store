import { Hono } from "hono";
import type { AppEnv } from "../auth-client";
import { publicError } from "../errors";

export const modelsRoute = new Hono<AppEnv>().get("/", async (c) => {
  const response = await fetch("https://ai-gateway.vercel.sh/v1/models");
  if (!response.ok)
    return c.json(
      publicError("MODEL_SERVICE_UNAVAILABLE", "Could not load available models."),
      502,
    );
  return c.json(await response.json());
});
