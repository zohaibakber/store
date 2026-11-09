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
  "EmailDeliveryError",
  {
    message: Schema.String,
  },
) {}

export class EmailProvider extends Context.Service<
  EmailProvider,
  {
    readonly deliversOtp: boolean;
    readonly sendOtp: (input: SendOtpInput) => Effect.Effect<void, EmailDeliveryError>;
  }
>()("@store/auth/EmailProvider") {
  static readonly layerDevelopment = Layer.succeed(
    this,
    this.of({
      deliversOtp: true,
      sendOtp: Effect.fn("EmailProvider.development.sendOtp")(function* (input) {
        yield* Effect.logInfo("auth.otp_requested").pipe(
          Effect.annotateLogs({
            code: input.code,
            expiresAt: input.expiresAt,
            delivery: "development-log-only",
          }),
        );
      }),
    }),
  );

  static readonly layerDisabled = Layer.succeed(
    this,
    this.of({
      deliversOtp: false,
      sendOtp: () =>
        Effect.fail(new EmailDeliveryError({ message: "One-time code delivery is disabled." })),
    }),
  );
}
