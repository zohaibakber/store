import { GoogleIdToken } from "@store/auth";
import * as Schema from "effect/Schema";

/**
 * Credential Manager on Android (bottom sheet) and Google Sign-In SDK on iOS.
 * Native modules are imported lazily so tests can load the error helpers
 * without linking Nitro.
 */
const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();

export const isGoogleSignInConfigured = Boolean(webClientId);

export type GoogleSignInResult =
  | { readonly _tag: "Signed"; readonly idToken: GoogleIdToken }
  | { readonly _tag: "Cancelled" };

/** Play services / Cloud Console reject an APK whose signing cert is not registered. */
export const GOOGLE_SIGN_IN_MISCONFIGURED =
  "Google rejected this app's signing key. Add this APK's SHA-1 to the Android OAuth client, or sign the build with the Play upload key.";

const GoogleCodedError = Schema.Struct({
  code: Schema.Union([Schema.Literal("10"), Schema.Literal(10), Schema.Literal("DEVELOPER_ERROR")]),
});

export const isGoogleDeveloperError = (cause: unknown) => Schema.is(GoogleCodedError)(cause);

type NitroGoogleSignIn = typeof import("react-native-nitro-google-signin");

let configuredModule: NitroGoogleSignIn | null = null;

const loadModule = async () => {
  if (configuredModule) return configuredModule;
  if (!webClientId) {
    throw new Error("Google sign-in is not configured for this build.");
  }
  const module = await import("react-native-nitro-google-signin").catch(() => {
    throw new Error("Google sign-in needs a new build of the app.");
  });
  module.GoogleOneTapSignIn.configure({
    webClientId,
    iosClientId,
    offlineAccess: false,
  });
  configuredModule = module;
  return module;
};

const nextCredential = async (
  module: NitroGoogleSignIn,
  response: Awaited<ReturnType<NitroGoogleSignIn["GoogleOneTapSignIn"]["signIn"]>>,
) => {
  if (module.isSuccessResponse(response) || module.isCancelledResponse(response)) {
    return response;
  }
  if (module.isNoSavedCredentialFoundResponse(response)) {
    return module.GoogleOneTapSignIn.createAccount();
  }
  return response;
};

const explicitIfNeeded = async (
  module: NitroGoogleSignIn,
  response: Awaited<ReturnType<NitroGoogleSignIn["GoogleOneTapSignIn"]["signIn"]>>,
) => {
  if (module.isNoSavedCredentialFoundResponse(response)) {
    return module.GoogleOneTapSignIn.presentExplicitSignIn();
  }
  return response;
};

export const signInWithGoogleAccount = async (): Promise<GoogleSignInResult> => {
  if (!webClientId) {
    throw new Error("Google sign-in is not configured for this build.");
  }
  const module = await loadModule();
  const {
    GoogleOneTapSignIn,
    isCancelledResponse,
    isErrorWithCode,
    isSuccessResponse,
    statusCodes,
  } = module;
  try {
    await GoogleOneTapSignIn.checkPlayServices(true);
    const silent = await GoogleOneTapSignIn.signIn();
    const created = await nextCredential(module, silent);
    const response = await explicitIfNeeded(module, created);
    if (isCancelledResponse(response)) return { _tag: "Cancelled" };
    if (!isSuccessResponse(response)) return { _tag: "Cancelled" };
    const idToken = response.data.idToken;
    if (!idToken) throw new Error("Google did not return an identity token.");
    return { _tag: "Signed", idToken: GoogleIdToken.make(idToken) };
  } catch (cause) {
    if (isErrorWithCode(cause)) {
      if (cause.code === statusCodes.SIGN_IN_CANCELLED || cause.code === statusCodes.IN_PROGRESS) {
        return { _tag: "Cancelled" };
      }
      if (cause.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new Error("Google Play services are unavailable on this device.");
      }
    }
    if (isGoogleDeveloperError(cause)) {
      throw new Error(GOOGLE_SIGN_IN_MISCONFIGURED);
    }
    throw cause;
  }
};

export const forgetGoogleAccount = async () => {
  if (!configuredModule) return;
  await configuredModule.GoogleOneTapSignIn.signOut().catch(() => null);
};
