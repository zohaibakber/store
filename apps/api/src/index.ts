import { createApp } from "./app";
import { workerErrorHandler, workerRuntime } from "./worker-runtime";

export { createApp } from "./app";

const app = createApp(workerRuntime);
app.onError(workerErrorHandler);

export default app;
