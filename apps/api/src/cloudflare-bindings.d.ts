/**
 * Production secrets are configured with `wrangler secret put`, so Wrangler
 * cannot discover them from the checked-in configuration when generating
 * bindings for a clean checkout.
 */
interface CloudflareBindings {
  readonly BETTER_AUTH_SECRET: string;
}
