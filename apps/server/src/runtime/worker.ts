import type { AuthAuditEvent } from "@store/auth";

export const reportError = (event: string, cause: unknown) => {
  console.error(
    JSON.stringify({
      event,
      message: cause instanceof Error ? cause.message : String(cause),
      stack: cause instanceof Error ? cause.stack : undefined,
    }),
  );
};

const authEventMessages: Record<AuthAuditEvent["event"], string> = {
  "auth.account.linked": "Authentication account linked.",
  "auth.session.created": "Authentication session created.",
  "auth.session.revoked": "Authentication session revoked.",
  "auth.user.created": "Authentication user created.",
};

export const reportAuthEvent = (event: AuthAuditEvent) => {
  console.info(JSON.stringify({ ...event, message: authEventMessages[event.event] }));
};
