import type { InvoiceAiClient } from "@store/services";
import { describe, expect, it, vi } from "vitest";

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
  it("denies unauthenticated upload requests", async () => {
    const response = await appFor(false).request(
      "/api/uploads",
      invoiceForm([pdf()]),
      workingAi().ai,
    );
    expect(response.status).toBe(401);
  });

  it("denies uploads when the session was revoked with organization access", async () => {
    // Membership removal invalidates the session; there is no separate member ping.
    const response = await appFor(false).request(
      "/api/uploads",
      invoiceForm([pdf()]),
      workingAi().ai,
    );
    expect(response.status).toBe(401);
  });

  it("never reaches the model when the caller is unauthorized", async () => {
    const { ai, generate } = workingAi();
    await appFor(false).request("/api/uploads", invoiceForm([pdf()]), ai);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("invoice upload validation", () => {
  it("rejects a request with no attachments", async () => {
    const response = await appFor(true).request("/api/uploads", invoiceForm([]), workingAi().ai);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "NO_ATTACHMENTS" } });
  });

  it("rejects attachments that are neither PDF nor CSV", async () => {
    const response = await appFor(true).request(
      "/api/uploads",
      invoiceForm([new File(["binary"], "invoice.docx")]),
      workingAi().ai,
    );
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ error: { code: "UNSUPPORTED_ATTACHMENT" } });
  });

  it("rejects more attachments than the batch limit", async () => {
    const files = Array.from({ length: 11 }, (_, index) => pdf(`invoice-${index}.pdf`));
    const response = await appFor(true).request("/api/uploads", invoiceForm(files), workingAi().ai);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "TOO_MANY_ATTACHMENTS" } });
  });
});

describe("invoice upload extraction", () => {
  it("converts attachments to markdown and returns the model's extraction", async () => {
    const { ai, generate } = workingAi();
    const response = await appFor(true).request("/api/uploads", invoiceForm([pdf()]), ai);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(extraction);
    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.any(Array),
        jsonSchema: expect.any(Object),
      }),
    );
  });

  it("extracts CSV attachments without calling the model at all", async () => {
    const { ai, generate } = workingAi();
    const csv = new File(
      ["name,packs,units per pack,pack price\nIbuprofen,3,20,9.5\n"],
      "invoice.csv",
      { type: "text/csv" },
    );
    const response = await appFor(true).request("/api/uploads", invoiceForm([csv]), ai);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      lines: [{ name: "Ibuprofen", packQuantity: 3, unitsPerPack: 20, packPrice: 950 }],
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps quoted CSV names and pack notation without asking the model", async () => {
    const { ai, generate } = workingAi();
    const csv = new File(
      ['name,packs,units per pack,pack price\n"Amoxicillin 250mg, Capsules",3,10x10,"1,250.00"\n'],
      "invoice.csv",
      { type: "text/csv" },
    );
    const response = await appFor(true).request("/api/uploads", invoiceForm([csv]), ai);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      lines: [
        {
          name: "Amoxicillin 250mg, Capsules",
          packQuantity: 3,
          unitsPerPack: 100,
          packPrice: 125000,
        },
      ],
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("does not add PDF extraction on top of CSV lines from the same upload", async () => {
    const { ai, generate } = workingAi();
    const csv = new File(
      ["name,packs,units per pack,pack price\nIbuprofen,3,20,9.5\n"],
      "invoice.csv",
      { type: "text/csv" },
    );
    const response = await appFor(true).request("/api/uploads", invoiceForm([csv, pdf()]), ai);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      lines: [{ name: "Ibuprofen", packQuantity: 3, unitsPerPack: 20, packPrice: 950 }],
    });
    expect(generate).not.toHaveBeenCalled();
    expect(ai.toMarkdown).not.toHaveBeenCalled();
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
