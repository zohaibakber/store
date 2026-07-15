import { createApp } from "./http/app";
import { workerErrorHandler, workerRuntime } from "./runtime/worker";

export { createApp } from "./http/app";

const app = createApp(workerRuntime);
app.onError(workerErrorHandler);

export default app;
