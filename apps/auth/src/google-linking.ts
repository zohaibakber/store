import { type EmailAddress } from "@store/auth";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import { AuthRefusal } from "./failures";

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1_000;
export const AUTHORIZATION_TTL_MS = 5 * 60 * 1_000;

const GOOGLE_MAILBOX = /@(gmail|googlemail)\.com$/u;

export const ownsMailbox = (hostedDomain: string | undefined, email: EmailAddress) =>
  (hostedDomain ?? "") !== "" || GOOGLE_MAILBOX.test(email);

interface LinkCandidate {
  readonly passwordHash: string | null;
  readonly emailVerified: boolean;
}

export type GoogleLink<User extends LinkCandidate> =
  | { readonly _tag: "Use"; readonly user: User }
  | { readonly _tag: "Create" }
  | { readonly _tag: "Claim"; readonly user: User }
  | { readonly _tag: "Attach"; readonly user: User };

export const decideGoogleLink = <User extends LinkCandidate>(
  linked: Option.Option<User>,
  existing: Option.Option<User>,
  mailboxProven: boolean,
): Result.Result<GoogleLink<User>, AuthRefusal> => {
  if (Option.isSome(linked)) return Result.succeed({ _tag: "Use", user: linked.value });
  if (Option.isNone(existing)) return Result.succeed({ _tag: "Create" });
  const user = existing.value;
  if (user.passwordHash && user.emailVerified) {
    return Result.fail(new AuthRefusal({ reason: "PasswordAccountExists" }));
  }
  if (!mailboxProven) return Result.fail(new AuthRefusal({ reason: "GoogleMailboxUnproven" }));
  return Result.succeed({ _tag: user.passwordHash ? "Claim" : "Attach", user });
};
