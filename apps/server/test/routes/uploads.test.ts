import type { InvoiceAiClient } from "@store/services";
import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vitest";

import { RATE_LIMITS } from "../../src/http/runtime";
import { appFor } from "../lib/app";

const invoiceForm = (files: ReadonlyArray<File>) => {
  const body = new FormData();
  for (const file of files) body.append("files", file);
  return { method: "POST", body } satisfies RequestInit;
};

const pdf = (name = "invoice.pdf") => new File(["%PDF-1.4"], name, { type: "application/pdf" });

const extraction = {
  supplier: "Acme Medical",
  invoiceNumber: "INV-42",
  lines: [
    {
      name: "Paracetamol",
      batchNumber: "B-100",
      expiresAt: "2027-12-31",
      packQuantity: 4,
      unitQuantity: 2,
      unitsPerPack: 10,
      packPrice: 1250,
    },
  ],
};

const markdownFor = (documents: ReadonlyArray<{ name: string }>) =>
  documents.map((document) => ({
    kind: "ok" as const,
    name: document.name,
    data: "| item | qty |\n| --- | --- |\n| Paracetamol | 4 |",
  }));

const workingAi = (generate = vi.fn(async () => JSON.stringify(extraction))) => ({
  ai: {
    toMarkdown: vi.fn(async (documents: ReadonlyArray<{ name: string }>) => markdownFor(documents)),
    generate,
  } satisfies InvoiceAiClient,
  generate,
});

describe("invoice upload authorization", () => {
  it("denies unauthenticated uploads without reaching the model", async () => {
    const { ai, generate } = workingAi();
    const response = await appFor(false).request("/api/uploads", invoiceForm([pdf()]), ai);
    expect(response.status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
  });

  it("rate limits invoice extraction before reading or converting attachments", async () => {
    const { ai, generate } = workingAi();
    const limitInvoiceExtraction = vi.fn(() => Effect.succeed({ success: false }));

    const response = await appFor(true, { limitInvoiceExtraction }).request(
      "/api/uploads",
      invoiceForm([pdf()]),
      ai,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe(String(RATE_LIMITS.invoiceExtraction.period));
    expect(await response.json()).toMatchObject({
      error: { code: "INVOICE_EXTRACTION_RATE_LIMITED" },
    });
    expect(limitInvoiceExtraction).toHaveBeenCalledWith("org-1:user-1");
    expect(ai.toMarkdown).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("invoice upload validation", () => {
  it.each([
    { name: "no attachments", files: [], status: 400, code: "NO_ATTACHMENTS" },
    {
      name: "an attachment that is neither PDF nor CSV",
      files: [new File(["binary"], "invoice.docx")],
      status: 415,
      code: "UNSUPPORTED_ATTACHMENT",
    },
    {
      name: "more attachments than the batch limit",
      files: Array.from({ length: 11 }, (_, index) => pdf(`invoice-${index}.pdf`)),
      status: 413,
      code: "TOO_MANY_ATTACHMENTS",
    },
  ])("rejects $name", async ({ files, status, code }) => {
    const response = await appFor(true).request("/api/uploads", invoiceForm(files), workingAi().ai);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
  });
});

describe("invoice upload extraction", () => {
  it("converts attachments to markdown and returns the model's extraction", async () => {
    const { ai, generate } = workingAi();
    const response = await appFor(true).request("/api/uploads", invoiceForm([pdf()]), ai);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(extraction);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("reports a failed extraction without leaking the underlying cause", async () => {
    const generate = vi.fn(async () => {
      throw new Error("workers ai neuron budget exhausted");
    });
    const response = await appFor(true).request(
      "/api/uploads",
      invoiceForm([pdf()]),
      workingAi(generate).ai,
    );
    expect(response.status).toBe(502);
    const body = JSON.stringify(await response.json());
    expect(body).toContain("EXTRACTION_FAILED");
    expect(body).not.toContain("neuron budget");
  });

  it("fails cleanly when no attachment can be converted to markdown", async () => {
    const ai = {
      toMarkdown: vi.fn(async (documents: ReadonlyArray<{ name: string }>) =>
        documents.map((document) => ({
          kind: "error" as const,
          name: document.name,
          error: "corrupt document",
        })),
      ),
      generate: vi.fn(),
    } satisfies InvoiceAiClient;
    const response = await appFor(true).request("/api/uploads", invoiceForm([pdf()]), ai);
    expect(response.status).toBe(502);
  });
});
