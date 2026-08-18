import { describe, expect, it } from "vitest";

import {
  clerkErrorMessage,
  clerkFieldMessage,
  clerkGlobalMessages,
  isIdentifierNotFound,
} from "../src/lib/clerk-errors";

describe("clerkErrorMessage", () => {
  it("prefers the long message when Clerk includes one", () => {
    expect(
      clerkErrorMessage({
        message: "Couldn't find your account.",
        longMessage: "Couldn't find your account.",
        code: "form_identifier_not_found",
      }),
    ).toBe("Couldn't find your account.");
  });
});

describe("clerkFieldMessage", () => {
  it("prefers identifier over emailAddress for the email field", () => {
    expect(
      clerkFieldMessage(
        {
          identifier: { message: "Identifier is missing" },
          emailAddress: { message: "Enter a valid email address." },
          code: { message: "Incorrect code" },
        },
        "email",
      ),
    ).toBe("Identifier is missing");
  });

  it("reads the code field", () => {
    expect(clerkFieldMessage({ code: { message: "Incorrect code" } }, "code")).toBe(
      "Incorrect code",
    );
  });
});

describe("clerkGlobalMessages", () => {
  it("treats a missing global list as no messages", () => {
    expect(clerkGlobalMessages(null)).toEqual([]);
  });
});

describe("isIdentifierNotFound", () => {
  it("matches Clerk's identifier-not-found code from the custom flow docs", () => {
    expect(isIdentifierNotFound({ code: "form_identifier_not_found" })).toBe(true);
    expect(isIdentifierNotFound({ code: "form_code_incorrect" })).toBe(false);
  });
});
