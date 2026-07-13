import { auth, trustedOrigins } from "@store/auth";
import { createApp } from "./app";
import { runSync } from "./sync/runtime";

export { createApp } from "./app";

export default createApp({
  authApi: auth.api,
  authHandler: (request) => auth.handler(request),
  runSync,
  trustedOrigins,
});
