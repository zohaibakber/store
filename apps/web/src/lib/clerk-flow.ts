import { useClerk, useSignIn, useSignUp } from "@/lib/clerk-runtime";

export const AUTH_PATHS = new Set(["/sign-in", "/sign-up", "/forgot-password", "/sso-callback"]);

export const isAuthPath = (pathname: string) => AUTH_PATHS.has(pathname);

/** Hash history (desktop) vs path history (web). */
export const clerkAppUrl = (path: string) => {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const { origin, pathname, hash } = window.location;
  if (hash.startsWith("#")) return `${origin}${pathname}#${normalized}`;
  return `${origin}${normalized}`;
};

export const skipClientNavigate = {
  navigate: ({
    session,
  }: {
    readonly session?: { readonly currentTask?: object | null } | null;
  }) => {
    if (session?.currentTask) return;
  },
};

type Factor = { readonly strategy: string };
type SignInResource = ReturnType<typeof useSignIn>["signIn"];
type SignUpResource = ReturnType<typeof useSignUp>["signUp"];
type ClerkResource = ReturnType<typeof useClerk>;

export const hasPasswordFirstFactor = (factors: ReadonlyArray<Factor> | null | undefined) =>
  (factors ?? []).some((factor) => factor.strategy === "password");

export const hasEmailCodeFirstFactor = (factors: ReadonlyArray<Factor> | null | undefined) =>
  (factors ?? []).some((factor) => factor.strategy === "email_code");

export const hasEmailCodeSecondFactor = (factors: ReadonlyArray<Factor> | null | undefined) =>
  (factors ?? []).some((factor) => factor.strategy === "email_code");

export const finalizeIfComplete = async (resource: SignInResource | SignUpResource) => {
  if (resource.status !== "complete") return false;
  await resource.finalize(skipClientNavigate);
  return true;
};

export type OAuthSettleResult =
  | { readonly kind: "activated" }
  | { readonly kind: "continue"; readonly path: "/sign-in" | "/sign-up" }
  | { readonly kind: "idle" };

export const googleSsoParams = () => ({
  strategy: "oauth_google" as const,
  redirectUrl: clerkAppUrl("/"),
  redirectCallbackUrl: clerkAppUrl("/sso-callback"),
});

export const settleOAuth = async (input: {
  readonly clerk: ClerkResource;
  readonly signIn: SignInResource;
  readonly signUp: SignUpResource;
}): Promise<OAuthSettleResult> => {
  const { clerk, signIn, signUp } = input;

  if (await finalizeIfComplete(signIn)) return { kind: "activated" };

  if (signUp.isTransferable) {
    const { error } = await signIn.create({ transfer: true });
    if (error) return { kind: "continue", path: "/sign-in" };
    if (await finalizeIfComplete(signIn)) return { kind: "activated" };
    return { kind: "continue", path: "/sign-in" };
  }

  if (
    signIn.status === "needs_first_factor" &&
    !signIn.supportedFirstFactors.every((factor) => factor.strategy === "enterprise_sso")
  ) {
    return { kind: "continue", path: "/sign-in" };
  }

  if (signIn.isTransferable) {
    const { error } = await signUp.create({ transfer: true });
    if (error) return { kind: "continue", path: "/sign-up" };
    if (await finalizeIfComplete(signUp)) return { kind: "activated" };
    return { kind: "continue", path: "/sign-up" };
  }

  if (await finalizeIfComplete(signUp)) return { kind: "activated" };

  if (
    signIn.status === "needs_second_factor" ||
    signIn.status === "needs_new_password" ||
    signIn.status === "needs_client_trust"
  ) {
    return { kind: "continue", path: "/sign-in" };
  }

  const sessionId = signIn.existingSession?.sessionId || signUp.existingSession?.sessionId;
  if (sessionId) {
    await clerk.setActive({ session: sessionId, navigate: skipClientNavigate.navigate });
    return { kind: "activated" };
  }

  return { kind: "idle" };
};
