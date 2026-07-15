import { expect, test } from "vitest";
import { persistenceError, PersistenceError } from "./errors";

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
