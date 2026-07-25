# Plan 018: Reject oversized uploads before the Worker buffers them

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8b1efa49..HEAD -- apps/server/src/routes/uploads.ts apps/server/src/routes/uploads.test.ts`
> If either changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `8b1efa49`, 2026-07-25

## Why this matters

`/api/uploads` enforces a 20 MB aggregate limit — but only _after_
`await c.req.formData()` has already materialized the entire request body in
Worker memory. An authenticated organization member can therefore send a body
far larger than 20 MB and the Worker will buffer all of it before deciding to
reject it, pushing toward the Workers 128 MB memory ceiling and killing the
isolate. Because `/api/sync` is served from the same Worker, that collateral
damage lands on the app's core data path.

There is also no **per-file** limit, only an aggregate one, and file type is
accepted on filename extension alone.

The fix is a cheap pre-parse guard plus a per-file cap. It is additive and
cannot break a legitimate upload that already satisfies the existing limit.

## Current state

`apps/server/src/routes/uploads.ts:9-37`:

```ts
/** Mirrors what the desktop uploader accepts before it sends anything. */
const isInvoice = (name: string) => /\.(csv|pdf)$/i.test(name);

const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export const uploadsRoute = new Hono<AppEnv>().post("/", async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json(publicError("INVALID_UPLOAD", "The upload body could not be read."), 400);
  }

  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (!files.length)
    return c.json(publicError("NO_ATTACHMENTS", "Attach at least one invoice file."), 400);
  if (files.length > MAX_FILES)
    return c.json(
      publicError("TOO_MANY_ATTACHMENTS", `Attach at most ${MAX_FILES} invoice files.`),
      413,
    );
  if (files.some((file) => !isInvoice(file.name)))
    return c.json(
      publicError("UNSUPPORTED_ATTACHMENT", "Only PDF and CSV invoices can be analysed."),
      415,
    );
  if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES)
    return c.json(publicError("ATTACHMENTS_TOO_LARGE", "The attachments are too large."), 413);
```

Note the ordering: `formData()` at the top, every limit check below it.

The route is mounted behind `requireOrganization` (`apps/server/src/http/app.ts:39`),
so callers are authenticated — this is an authenticated-abuse and
availability concern, not an anonymous one.

### Error-response convention

Errors use the `publicError(code, message)` helper from
`apps/server/src/http/errors.ts`, returned via `c.json(..., status)`. Match
that exactly — a new failure mode gets a new stable `code` string, and the
message must stay user-facing and free of internal detail.

Existing codes in this route: `INVALID_UPLOAD` (400), `NO_ATTACHMENTS` (400),
`TOO_MANY_ATTACHMENTS` (413), `UNSUPPORTED_ATTACHMENT` (415),
`ATTACHMENTS_TOO_LARGE` (413), `EXTRACTION_FAILED`.

### Test pattern

`apps/server/src/routes/uploads.test.ts` is the model — plain `vitest`, driving
the real Hono app through the `appFor` harness:

```ts
import { describe, expect, it, vi } from "vitest";

import { appFor } from "../testing/app";

const invoiceForm = (files: ReadonlyArray<File>) => {
  const body = new FormData();
  for (const file of files) body.append("files", file);
  return { method: "POST", body } satisfies RequestInit;
};

const pdf = (name = "invoice.pdf") => new File(["%PDF-1.4"], name, { type: "application/pdf" });
```

```ts
const envWith = (ai: { toMarkdown: unknown; run: unknown }) => ({ AI: ai }) as unknown as Env;
```

Requests are issued as `appFor(true).request("/api/uploads", init, env)`.

### Conventions

- This route is plain Hono `async`/`await`, **not** Effect. Only the
  extraction call inside the handler uses `Effect.runPromise`. Do not convert
  the handler to Effect.
- Keep the handler thin: validate, call the service, map failures to
  responses.

## Commands you will need

| Purpose               | Command                    | Expected on success |
| --------------------- | -------------------------- | ------------------- |
| Format/lint/typecheck | `bunx vp check`            | exit 0              |
| Server tests          | `bunx vp test apps/server` | exit 0, all pass    |
| Full tests            | `bunx vp test`             | exit 0              |
| Workspace checks      | `bun run check`            | exit 0              |

## Scope

**In scope**:

- `apps/server/src/routes/uploads.ts`
- `apps/server/src/routes/uploads.test.ts`

**Out of scope** (do NOT touch):

- `apps/server/src/http/app.ts` — no middleware changes; the guard belongs in
  the route.
- Rate limiting. Per-organization throttling of this AI-backed endpoint is a
  real and separate finding; it needs a Durable Object or KV counter and is
  its own plan. Do **not** add it here.
- `packages/services/src/invoice-extraction.ts` — prompt hardening against
  untrusted document content is a separate finding. Not this plan.
- The desktop uploader (`apps/desktop/src/components/uploads/**`). Mirroring
  these limits client-side is worthwhile but separate; this plan secures the
  server boundary only.
- Do not lower `MAX_TOTAL_BYTES` or `MAX_FILES` — the existing limits are the
  product decision; this plan only enforces them earlier and adds a per-file cap.

## Git workflow

- Branch: `advisor/018-upload-size-precheck`
- Commit per step is fine. Message style matches `git log` (short imperative,
  no prefix), e.g. `Reject oversized uploads before parsing the body`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the pre-parse `Content-Length` guard

At the very top of the handler — **before** `await c.req.formData()` — read
`c.req.header("content-length")`. If it is present and parses to a number
greater than `MAX_TOTAL_BYTES` plus a small multipart overhead allowance,
return `413` with a new code `UPLOAD_TOO_LARGE` and a user-facing message.

Define the overhead allowance as a named constant (for example
`MULTIPART_OVERHEAD_BYTES = 1024 * 1024`) with a one-line comment explaining
that multipart framing makes the body slightly larger than the sum of file
sizes, so the pre-check must be more permissive than the post-parse check.

Treat a missing or unparseable `Content-Length` as "unknown" and fall through
to the existing post-parse checks — do not reject on absence.

**Verify**: `bunx vp check` → exit 0.

### Step 2: Add a per-file size cap

Add `MAX_FILE_BYTES` (use 10 MB — half the aggregate, so a single file can
never dominate the budget) and, alongside the existing aggregate check, reject
when any individual file exceeds it. Use a distinct code, `ATTACHMENT_TOO_LARGE`
(singular), returned as `413`, so the client can tell the two cases apart.

Keep the existing aggregate `ATTACHMENTS_TOO_LARGE` check as well — the two
limits are independent.

**Verify**: `bunx vp check` → exit 0.

### Step 3: Order the checks cheapest-first

Confirm the final handler order is:

1. `Content-Length` pre-check (no body read)
2. `formData()` parse
3. empty / too-many-files
4. extension check
5. per-file size
6. aggregate size
7. extraction

The point of the plan is that the most expensive step happens as late as
possible.

**Verify**: read the handler top to bottom and confirm the order; then
`bunx vp test apps/server` → exit 0 (existing tests unchanged).

### Step 4: Add regression tests

In `apps/server/src/routes/uploads.test.ts`, add cases:

1. **Oversized `Content-Length` is rejected without parsing.** Issue a request
   with an explicit `Content-Length` header far above the limit and assert
   `413` with code `UPLOAD_TOO_LARGE`. To prove the body was never parsed,
   pass an `AI` stub whose `toMarkdown`/`run` are `vi.fn()` and assert neither
   was called.
2. **A single oversized file is rejected.** Construct one `File` larger than
   `MAX_FILE_BYTES` but with the request otherwise valid; assert `413` with
   code `ATTACHMENT_TOO_LARGE`.
3. **The aggregate limit still applies.** Several files each under
   `MAX_FILE_BYTES` but summing over `MAX_TOTAL_BYTES` → `413` with
   `ATTACHMENTS_TOO_LARGE`.
4. **A normal upload still succeeds.** An existing happy-path test already
   covers this — confirm it still passes rather than duplicating it.

For large files, build content without allocating the full buffer repeatedly —
e.g. `new File([new Uint8Array(size)], "big.pdf", { type: "application/pdf" })`.
Keep the sizes just over the thresholds, not gratuitously large, so the suite
stays fast.

**Verify**: `bunx vp test apps/server` → exit 0, with the new cases passing.

### Step 5: Full verification

**Verify**: `bunx vp check` → exit 0; `bunx vp test` → exit 0;
`bun run check` → exit 0.

## Test plan

Four cases as listed in Step 4, added to the existing
`apps/server/src/routes/uploads.test.ts`. Structural pattern: that same file's
existing tests.

The load-bearing assertion is in case 1 — that the AI stub was **not** invoked
— because it is the only test that distinguishes "rejected early" from
"rejected after doing all the expensive work".

Verification: `bunx vp test apps/server` → all pass, including 3 new tests
plus the unchanged happy path.

## Done criteria

ALL must hold:

- [ ] `bunx vp check` exits 0
- [ ] `bunx vp test` exits 0
- [ ] `grep -n 'content-length' apps/server/src/routes/uploads.ts` → matches,
      and the match appears **before** the `formData()` call in the file
- [ ] `grep -n 'MAX_FILE_BYTES' apps/server/src/routes/uploads.ts` → matches
- [ ] New codes `UPLOAD_TOO_LARGE` and `ATTACHMENT_TOO_LARGE` are returned with
      status 413
- [ ] Existing upload tests all still pass, unmodified
- [ ] `bun run check` exits 0
- [ ] `git status --short` lists only the two in-scope files
- [ ] `plans/README.md` status row for 018 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The Hono/Workers test environment does not let you set a `Content-Length`
  header on a request with a `FormData` body (the runtime may compute it).
  If so, report it — the guard is still correct in production, but the test
  needs a different construction and you should not fake it with a cast.
- Any existing upload test fails after your change. The guard is meant to be
  additive; a failure means a legitimate request is now being rejected.
- You find that `c.req.formData()` in this runtime streams rather than buffers,
  making the pre-check unnecessary. Report the evidence rather than removing
  the guard — a `Content-Length` check is still cheap and correct.
- Implementing this appears to require touching `http/app.ts` or adding
  middleware.

## Maintenance notes

- The client does **not** mirror these limits: `apps/desktop` will still upload
  the full body before receiving a 413. Adding client-side pre-checks (and
  sharing `MAX_FILES` / `MAX_TOTAL_BYTES` / the invoice file pattern through
  `@store/contracts`, where they belong) is a worthwhile follow-up — the same
  regex is currently written out three times across the server route, the
  upload context, and the dropzone.
- Still open after this plan, and worth tracking: there is **no rate limiting**
  on this endpoint, so an authenticated member can still issue unbounded
  _within-limit_ requests, each triggering billed document conversion and
  inference. That is the larger cost-control gap.
- File type is still accepted on filename extension only; `file.type` is never
  checked. Validating the declared MIME type against the extension is a cheap
  addition whenever someone next touches this handler.
- A reviewer should confirm the `Content-Length` check tolerates a **missing**
  header rather than rejecting on it — over-strict handling there would break
  legitimate chunked uploads.
