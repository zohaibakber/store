import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { EmailAddress, InvitationToken, OrganizationRole, OtpCode } from "./model";

export interface SendOtpInput {
  readonly email: EmailAddress;
  readonly code: OtpCode;
  readonly expiresAt: number;
}

export interface SendInvitationInput {
  readonly email: EmailAddress;
  readonly organizationName: string;
  readonly role: OrganizationRole;
  readonly invitedBy: string;
  readonly token: InvitationToken;
  readonly expiresAt: number;
}

export class EmailDeliveryError extends Schema.TaggedError<EmailDeliveryError>()(
  "Auth.EmailDeliveryError",
  {
    message: Schema.String,
  },
) {}

export interface EmailProviderApi {
  readonly sendOtp: (input: SendOtpInput) => Effect.Effect<void, EmailDeliveryError>;
  readonly sendInvitation: (input: SendInvitationInput) => Effect.Effect<void, EmailDeliveryError>;
}

export class EmailProvider extends Context.Service<EmailProvider, EmailProviderApi>()(
  "@store/auth/EmailProvider",
) {}

export const developmentEmailLayer = Layer.succeed(
  EmailProvider,
  EmailProvider.of({
    sendOtp: Effect.fn("EmailProvider.development.sendOtp")(function* (input) {
      yield* Effect.logInfo("auth.otp_requested").pipe(
        Effect.annotateLogs({
          email: input.email,
          code: input.code,
          expiresAt: input.expiresAt,
          delivery: "development-log-only",
        }),
      );
    }),
    sendInvitation: Effect.fn("EmailProvider.development.sendInvitation")(function* (input) {
      yield* Effect.logInfo("auth.invitation_created").pipe(
        Effect.annotateLogs({
          email: input.email,
          organization: input.organizationName,
          role: input.role,
          expiresAt: input.expiresAt,
          delivery: "development-log-only",
        }),
      );
    }),
  }),
);

export const disabledEmailLayer = Layer.succeed(
  EmailProvider,
  EmailProvider.of({
    sendOtp: Effect.fn("EmailProvider.disabled.sendOtp")(function* (input) {
      yield* Effect.logInfo("auth.otp_delivery_disabled").pipe(
        Effect.annotateLogs({
          email: input.email,
          expiresAt: input.expiresAt,
          delivery: "disabled",
        }),
      );
    }),
    sendInvitation: Effect.fn("EmailProvider.disabled.sendInvitation")(function* (input) {
      yield* Effect.logInfo("auth.invitation_delivery_disabled").pipe(
        Effect.annotateLogs({
          email: input.email,
          organization: input.organizationName,
          role: input.role,
          expiresAt: input.expiresAt,
          delivery: "disabled",
        }),
      );
    }),
  }),
);
