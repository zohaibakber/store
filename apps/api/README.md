# Store invoice API

A Hono app, deployed to Vercel as a Vercel Function, that accepts invoice attachments and returns
structured inventory lines.

```sh
bunx vercel --prod
```

Set `AI_GATEWAY_API_KEY` in the Vercel project. The service uses AI SDK through Vercel AI Gateway,
so the selected model can come from any supported provider. Run `bun run vercel:dev` for local
development — it serves `src/index.ts` directly with Vercel's local emulation and automatically
refreshed Gateway development credentials.

Set `VITE_API_URL` in the desktop app to the deployed API URL. During local development,
`http://localhost:8787/api` is used by default.

`POST /uploads` accepts multipart `files` (PDF, CSV, or invoice images) and returns the extraction
review. The desktop applies approved changes locally and uses its existing Turso sync service to
push and pull database state.
