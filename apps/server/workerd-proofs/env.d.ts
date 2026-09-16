import type { Env } from "./worker";

declare module "cloudflare:workers" {
  interface ProvidedEnv extends Env {}
}
