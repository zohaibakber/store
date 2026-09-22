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
