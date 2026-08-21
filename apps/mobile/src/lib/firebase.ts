import { getAI, GoogleAIBackend, type AI } from "firebase/ai";
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";

import firebaseConfig from "../../firebase-config.json";

/**
 * Firebase web config for Expo. AI Logic is called through the JS SDK with the
 * Gemini Developer API backend. This path does not need a native google-services
 * file.
 *
 * TODO(production): enable App Check (reCAPTCHA Enterprise / DeviceCheck) so
 * client quota cannot be abused from unsigned builds.
 */
export const getFirebaseApp = (): FirebaseApp => {
  if (getApps().length > 0) return getApp();
  return initializeApp({
    apiKey: firebaseConfig.apiKey,
    authDomain: firebaseConfig.authDomain,
    projectId: firebaseConfig.projectId,
    storageBucket: firebaseConfig.storageBucket,
    messagingSenderId: firebaseConfig.messagingSenderId,
    appId: firebaseConfig.appId,
    measurementId: firebaseConfig.measurementId || undefined,
  });
};

export const getFirebaseAi = (): AI => getAI(getFirebaseApp(), { backend: new GoogleAIBackend() });
