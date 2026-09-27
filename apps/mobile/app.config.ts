import type { ConfigContext, ExpoConfig } from "expo/config";

const variant = process.env.APP_VARIANT === "production" ? "production" : "development";
const isDevelopment = variant === "development";

const applicationId = isDevelopment ? "com.tabaaq.mobile.debug" : "com.tabaaq.mobile";
const scheme = process.env.MOBILE_PROTOCOL ?? applicationId;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: isDevelopment ? "Store Dev" : "Store",
  slug: "store",
  owner: "zohaibakber",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme,
  userInterfaceStyle: "light",
  platforms: ["android"],
  android: {
    package: applicationId,
    adaptiveIcon: {
      backgroundColor: "#FFFFFF",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: true,
    permissions: ["android.permission.CAMERA"],
    blockedPermissions: ["android.permission.RECORD_AUDIO"],
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#FFFFFF",
        image: "./assets/images/splash-icon.png",
        imageWidth: 76,
      },
    ],
    [
      "expo-font",
      {
        fonts: [
          "./node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf",
          "./node_modules/@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf",
          "./node_modules/@expo-google-fonts/jetbrains-mono/400Regular/JetBrainsMono_400Regular.ttf",
        ],
      },
    ],
    "expo-secure-store",
    [
      "react-native-vision-camera-mlkit",
      {
        textRecognition: true,
        textRecognitionChinese: false,
        textRecognitionDevanagari: false,
        textRecognitionJapanese: false,
        textRecognitionKorean: false,
        barcodeScanning: false,
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          usesCleartextTraffic: isDevelopment,
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787",
    authBaseUrl: process.env.EXPO_PUBLIC_AUTH_URL ?? "http://localhost:8788",
    googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "",
    variant,
    eas: {
      projectId: "fb9c96f3-9e3d-40c9-8b7b-391e95d2aa94",
    },
  },
});
