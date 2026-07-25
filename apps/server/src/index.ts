import { createApp } from "./http/app";
import { workerErrorHandler, workerRuntime } from "./runtime/worker";

export { createApp } from "./http/app";
// Cloudflare resolves Durable Object classes from the Worker's exports.
export { OrganizationStore } from "./sync/organization-store";

const app = createApp(workerRuntime);
app.onError(workerErrorHandler);

export default app;
