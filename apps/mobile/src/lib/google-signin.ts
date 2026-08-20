import { GoogleIdToken } from "@store/auth";

/**
 * Google's own account picker: the GIDSignIn sheet on iOS, the account chooser
 * on Android. Tabaaq never draws this UI, it only receives the ID token.
 *
 * The SDK is a native module, so it is imported lazily. A build made before
 * this dependency existed would otherwise throw while the auth screen mounts.
 */
const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();

export const isGoogleSignInConfigured = Boolean(webClientId);

export type GoogleSignInResult =
  | { readonly _tag: "Signed"; readonly idToken: GoogleIdToken }
  | { readonly _tag: "Cancelled" };

type GoogleSignInModule = typeof import("@react-native-google-signin/google-signin");

let configuredModule: GoogleSignInModule | null = null;

const loadModule = async () => {
  if (configuredModule) return configuredModule;
  const module = await import("@react-native-google-signin/google-signin").catch(() => {
    throw new Error("Google sign-in needs a new build of the app.");
  });
  module.GoogleSignin.configure({
    /** The web client ID is what makes Google mint the ID token we verify. */
    webClientId,
    iosClientId,
    /** Email and profile only. Tabaaq never calls Google APIs for the user. */
    offlineAccess: false,
  });
  configuredModule = module;
  return module;
};

export const signInWithGoogleAccount = async (): Promise<GoogleSignInResult> => {
  if (!webClientId) {
    throw new Error("Google sign-in is not configured for this build.");
  }
  const { GoogleSignin, isSuccessResponse, isErrorWithCode, statusCodes } = await loadModule();
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
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
    throw cause;
  }
};

/** Forget the account so the next sign-in shows the picker again. */
export const forgetGoogleAccount = async () => {
  if (!configuredModule) return;
  await configuredModule.GoogleSignin.signOut().catch(() => null);
};
