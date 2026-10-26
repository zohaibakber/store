import * as Schema from "effect/Schema";

export const SessionFamilyId = Schema.String.pipe(Schema.brand("SessionFamilyId"));
export type SessionFamilyId = typeof SessionFamilyId.Type;

export const GoogleAccountId = Schema.String.pipe(Schema.brand("GoogleAccountId"));
export type GoogleAccountId = typeof GoogleAccountId.Type;

export const OAuthState = Schema.String.pipe(Schema.brand("OAuthState"));
export type OAuthState = typeof OAuthState.Type;
