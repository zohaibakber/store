import { decodeStoreError, encodeStoreError } from "@store/contracts";
import { expect, test } from "vitest";
import {
  InvoiceNotFoundError,
  persistenceError,
  PersistenceError,
  ProductNotFoundError,
} from "./errors";

test("persistenceError preserves the original Error cause", () => {
  const cause = new Error("boom");

  const error = persistenceError("load", cause);

  expect(error._tag).toBe("PersistenceError");
  expect(error.operation).toBe("load");
  expect(error.message).toBe("boom");
  expect(error.cause).toBe(cause);
});

test("persistenceError returns an existing PersistenceError unchanged", () => {
  const error = PersistenceError.make({ operation: "load", message: "boom" });

  expect(persistenceError("save", error)).toBe(error);
});

test("persistenceError preserves a non-Error cause", () => {
  const error = persistenceError("load", "boom");

  expect(error.message).toBe("boom");
  expect(error.cause).toBe("boom");
});

test("PersistenceError survives an encoded structured-clone round trip", () => {
  const error = PersistenceError.make({
    operation: "load invoices",
    message: "database unavailable",
    cause: new Error("connection closed"),
  });

  const encoded = encodeStoreError(error);
  const cloned = structuredClone(encoded);
  const decoded = decodeStoreError(cloned);

  expect(encoded).toEqual({
    _tag: "PersistenceError",
    operation: "load invoices",
    message: "database unavailable",
    cause: { name: "Error", message: "connection closed" },
  });
  expect(decoded).toBeInstanceOf(PersistenceError);
  expect(decoded).toMatchObject({
    _tag: "PersistenceError",
    operation: "load invoices",
    message: "database unavailable",
  });
  if (decoded._tag === "PersistenceError") {
    expect(decoded.cause).toBeInstanceOf(Error);
    expect(decoded.cause).toMatchObject({ name: "Error", message: "connection closed" });
  }
});

test("ProductNotFoundError survives an encoded structured-clone round trip", () => {
  const error = ProductNotFoundError.make({ id: "product-1" });

  const encoded = structuredClone(encodeStoreError(error));
  const decoded = decodeStoreError(encoded);

  expect(encoded).toEqual({ _tag: "ProductNotFoundError", id: "product-1" });
  expect(decoded).toBeInstanceOf(ProductNotFoundError);
  expect(decoded).toMatchObject({ _tag: "ProductNotFoundError", id: "product-1" });
});

test("InvoiceNotFoundError survives an encoded structured-clone round trip", () => {
  const error = InvoiceNotFoundError.make({ id: "invoice-1" });

  const encoded = structuredClone(encodeStoreError(error));
  const decoded = decodeStoreError(encoded);

  expect(encoded).toEqual({ _tag: "InvoiceNotFoundError", id: "invoice-1" });
  expect(decoded).toBeInstanceOf(InvoiceNotFoundError);
  expect(decoded).toMatchObject({ _tag: "InvoiceNotFoundError", id: "invoice-1" });
});
