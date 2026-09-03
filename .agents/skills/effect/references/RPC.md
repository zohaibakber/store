# RPC And HttpApi

Use this when defining typed remote procedures, streaming RPCs, or when
choosing between Effect RPC and HttpApi.

Unstable imports:

- `effect/unstable/rpc` (`Rpc`, `RpcGroup`, `RpcClient`, `RpcServer`)
- `effect/unstable/httpapi` (`HttpApi`, `HttpApiEndpoint`, `HttpApiGroup`, `HttpApiBuilder`, `HttpApiClient`)
- `effect/unstable/http` (`HttpClient`, `HttpServer`, `HttpRouter`)
- `effect/unstable/socket` (WebSocket constructors)

This repo’s public inventory and auth surface is **HttpApi** (`StoreApi`).
Prefer adding HttpApi endpoints over introducing Cluster/Entity RPC unless
you have a real multi-node sharding need.

## Chooser

| Need | Use |
| --- | --- |
| Browser/Worker/Electron talking to the Cloudflare API | Shared `HttpApi` + `HttpApiClient.make` or a thin `fetch` adapter that decodes with Schema |
| Bidirectional typed procedures, streaming, Node cluster | `Rpc.make` + `RpcGroup` + `RpcServer` / `RpcClient` |
| Sharded stateful entities | `effect/unstable/cluster` `Entity.make` — only when multi-node is real |
| Durable workflows | `effect/unstable/workflow` — not the catalog replica |

## HttpApi (default here)

Keep contracts in `@store/contracts` as Schema. Endpoints stay thin: decode,
read `CurrentOrganization`, call a persistence module, map
`Schema.TaggedError` to HTTP.

Client: `HttpApiClient.make(StoreApi, { baseUrl })` over FetchHttpClient
when the host is Effect-shaped. Browser cookie/session adapters may keep
`fetch`. Catalog transport is an **adapter** behind `CatalogTransport`; it
must not leak into routes.

## RPC sketch (when HttpApi is the wrong seam)

```ts
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import * as Schema from "effect/Schema";

const Pull = Rpc.make("Pull", {
  payload: Schema.Struct({ cursor: Schema.Number }),
  success: Schema.Struct({ cursor: Schema.Number, changes: Schema.Array(Schema.Unknown) }),
});

class CatalogRpc extends RpcGroup.make("Catalog")(Pull) {}
```

Concurrent handlers: wrap with `Rpc.fork`. Default is sequential.

Serialization (rc.112): RPC and cluster protocols take `codecFor` so payloads
use the transport's schema codec. Framing and built-in wire formats stay as
they are. For Effect RPC / TCP cluster, prefer `SchemaBinary`
(`effect/unstable/encoding`) over Msgpack unless you have a reason to keep
Msgpack. HttpApi and this repo's catalog pull/push stay JSON.

Do not run Cluster runners on Cloudflare Workers for org-scoped inventory.
Postgres remains catalog authority; RPC would only replace HTTP as the
transport adapter.
