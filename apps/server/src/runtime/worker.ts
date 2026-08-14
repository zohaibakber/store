import type { AuthAuditEvent } from "@store/auth";
import type { RejectedAuthSetting } from "@store/auth/security";

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

/**
 * An unusable auth variable is ignored rather than thrown, which keeps sign-in
 * working everywhere the rest of the configuration allows. Name the setting, the
 * value, and the reason: this log is the only trace it leaves.
 */
export const reportRejectedAuthSettings = (rejected: ReadonlyArray<RejectedAuthSetting>) => {
  for (const setting of rejected)
    console.error(
      JSON.stringify({
        event: "auth.setting_rejected",
        message: `${setting.setting} value "${setting.value}" ${setting.reason} and was ignored.`,
        setting: setting.setting,
        value: setting.value,
        reason: setting.reason,
      }),
    );
};
