# Auth wall — synthesis

## Synthesis decision

**Base: Candidate A** (`HostAccessPolicy` injected at bootstrap → router context).

**Graft from Candidate B:** when web `guestMode`/browser policy is active, do not open a Locked local store on unsigned bootstrap (`startWebWorkspace` / store open). Navigation wall alone is not enough if `tabaaq-locked` still serves inventory under the shell.

**Reject pure B** as the primary seam: a boolean `guestMode` + shell outside the router is shallower (callers still invent sign-in chrome / redirects), unmounts the route tree (weaker deep-link / post-auth URL behavior), and forces lifting `AuthProvider` out of `__root` for less gain than A’s verdict-shaped interface.

**Reject** per-route `VITE_ELECTRON`, split route trees, and bare `requireAuth: boolean` (policy leaks back into routes).

## Chosen shape (implement)

1. `apps/web/src/host-access.ts` — `HostAccessPolicy` + `browserHostAccess` / `desktopHostAccess`
2. Thread `access` through `mountApp` → `getRouter` → `RouterContext`
3. `__root` `beforeLoad` calls `admit`; chrome uses `access.chrome`
4. Sign-in reads `access.signIn.allowContinueOffline`
5. Web workspace: refuse Locked open (graft) so unsigned browser has no guest DB

## Next implementation step

Implement `host-access.ts` adapters + wire bootstrap/router/sign-in + refuse Locked on web.
