import { InvoiceExtractionService, invoiceExtractionLayer } from "@store/services";
import * as Effect from "effect/Effect";
import { Hono } from "hono";
import { cors } from "hono/cors";

const acceptedFile = (file: File) =>
  file.name.toLowerCase().endsWith(".csv") || file.name.toLowerCase().endsWith(".pdf");

const defaultModel = "openai/gpt-4.1-mini";
const isGatewayModel = (value: string) => /^[a-z0-9][a-z0-9._/-]{1,160}$/i.test(value);

const app = new Hono();
const api = app.basePath("/api");

app.get("/", (c) =>
  c.json({
    service: "Store Invoice API",
    endpoints: ["/api/health", "/api/models", "/api/uploads"],
  }),
);
api.use("/*", cors());
api.get("/", (c) => c.json({ service: "Store Invoice API", ok: true }));
api.get("/health", (c) => c.json({ ok: true }));
api.get("/models", async (c) => {
  const response = await fetch("https://ai-gateway.vercel.sh/v1/models");
  if (!response.ok) return c.json({ error: "Could not load AI Gateway models." }, 502);
  return c.json(await response.json());
});
api.post("/uploads", async (c) => {
  const body = await c.req.parseBody({ all: true });
  const files = (Array.isArray(body.files) ? body.files : [body.files]).filter(
    (value): value is File => value instanceof File,
  );
  if (!files.length) return c.json({ error: "Attach at least one CSV or PDF invoice." }, 400);
  if (files.some((file) => !acceptedFile(file)))
    return c.json({ error: "Only CSV and PDF invoices are supported." }, 415);
  const model =
    typeof body.model === "string" && isGatewayModel(body.model) ? body.model : defaultModel;
  try {
    const extraction = await Effect.runPromise(
      Effect.flatMap(InvoiceExtractionService, (service) => service.extract(files)).pipe(
        Effect.provide(
          invoiceExtractionLayer({
            model,
          }),
        ),
      ),
    );
    return c.json(extraction);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Invoice parsing failed" },
      422,
    );
  }
});

export default app;
