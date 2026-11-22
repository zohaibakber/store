import { SyncProtocolError } from "@store/contracts";
import * as Schema from "effect/Schema";

export class AuthorityRequestMalformed extends Schema.TaggedError<AuthorityRequestMalformed>()(
  "AuthorityRequestMalformed",
  { message: Schema.String },
) {}

/** The failures an `OrgAuthority` RPC method answers with. Anything else is a defect. */
export type AuthorityFailure = SyncProtocolError | AuthorityRequestMalformed;

/**
 * Declared on the Durable Object so Alchemy rebuilds these classes on the
 * calling side of the Worker to Durable Object RPC.
 */
export const AUTHORITY_FAILURES = [SyncProtocolError, AuthorityRequestMalformed] as const;

export const isAuthorityFailure = Schema.is(Schema.Union(AUTHORITY_FAILURES));
