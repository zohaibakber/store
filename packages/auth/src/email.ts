import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { EmailAddress, OtpCode } from "./model";

export interface SendOtpInput {
  readonly email: EmailAddress;
  readonly code: OtpCode;
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
}

export class EmailProvider extends Context.Service<EmailProvider, EmailProviderApi>()(
  "@store/auth/EmailProvider",
) {}

/**
 * Development adapter. It emits a structured log event but never claims that
 * an email was delivered. Production should replace this layer.
 */
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
  }),
);

/**
 * Production placeholder until Cloudflare Email is wired. It records that an
 * OTP was requested without logging the code or claiming delivery.
 */
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
  }),
);
