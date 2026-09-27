import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from "@react-native-google-signin/google-signin";

import type { GoogleIdentity, GoogleIdTokenResult } from "./controller";

const DEVELOPER_ERROR = "10";

const failedWith = (message: string): GoogleIdTokenResult => ({ _tag: "Failed", message });

const describeGoogleError = (cause: unknown): GoogleIdTokenResult => {
  if (!isErrorWithCode(cause)) return failedWith("Google sign-in didn't finish. Try again.");
  switch (cause.code) {
    case statusCodes.SIGN_IN_CANCELLED:
      return { _tag: "Cancelled" };
    case statusCodes.IN_PROGRESS:
      return failedWith("Google sign-in is already open.");
    case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
      return failedWith("Google Play services is not available on this phone.");
    case DEVELOPER_ERROR:
      return failedWith("Google sign-in isn't set up for this build.");
    default:
      return failedWith("Google sign-in didn't finish. Try again.");
  }
};

export const makeGoogleIdentity = (webClientId: string): GoogleIdentity => {
  GoogleSignin.configure({ webClientId, offlineAccess: false });

  return {
    requestIdToken: async () => {
      try {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        const response = await GoogleSignin.signIn();
        if (!isSuccessResponse(response)) return { _tag: "Cancelled" };
        await GoogleSignin.signOut().catch(() => null);
        const idToken = response.data.idToken;
        return idToken === null
          ? failedWith("Google didn't confirm your account. Try again.")
          : { _tag: "Token", idToken };
      } catch (cause) {
        return describeGoogleError(cause);
      }
    },
    forget: async () => {
      await GoogleSignin.signOut().catch(() => null);
    },
  };
};
