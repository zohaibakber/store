const {
  withAppBuildGradle,
  withAndroidManifest,
  withDangerousMod,
} = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const PRODUCTION_ID = "com.tabaaq.mobile";
const DEBUG_ID = `${PRODUCTION_ID}.debug`;
const ANDROID_COMPONENTS = `
androidComponents {
    onVariants(selector().withBuildType("release")) { variant ->
        variant.applicationId.set("${PRODUCTION_ID}")
    }
}
`;

const debugPlaceholders = `manifestPlaceholders = [appAuthScheme: '${DEBUG_ID}']`;

const releasePlaceholders = `manifestPlaceholders = [appAuthScheme: '${PRODUCTION_ID}']`;

const debugStrings = `<resources>
  <string name="app_name">Tabaaq Dev</string>
</resources>
`;

const withDebugApplicationId = (config) =>
  withAppBuildGradle(config, (mod) => {
    let { contents } = mod.modResults;
    contents = contents.replace(
      /applicationId ['"]com\.tabaaq\.mobile['"]/,
      `applicationId '${DEBUG_ID}'`,
    );
    if (!contents.includes("appAuthScheme:")) {
      contents = contents.replace(
        /buildConfigField "String", "REACT_NATIVE_RELEASE_LEVEL".*\n/,
        (line) => `${line}        ${debugPlaceholders}\n`,
      );
      contents = contents.replace(
        /signingConfig signingConfigs.debug\n            def enableShrinkResources/,
        `signingConfig signingConfigs.debug\n            ${releasePlaceholders}\n            def enableShrinkResources`,
      );
    }
    if (!contents.includes("versionNameSuffix")) {
      contents = contents.replace(
        "signingConfig signingConfigs.debug\n        }",
        "signingConfig signingConfigs.debug\n            versionNameSuffix '-debug'\n        }",
      );
    }
    if (!contents.includes("androidComponents")) {
      contents = `${contents.trimEnd()}\n${ANDROID_COMPONENTS}`;
    }
    mod.modResults.contents = contents;
    return mod;
  });

const withDebugManifestPlaceholders = (config) =>
  withAndroidManifest(config, (mod) => {
    const activity = mod.modResults.manifest.application?.[0]?.activity?.find(
      (entry) => entry.$?.["android:name"] === ".MainActivity",
    );
    for (const filter of activity?.["intent-filter"] ?? []) {
      for (const data of filter.data ?? []) {
        if (
          data.$?.["android:scheme"] === PRODUCTION_ID ||
          data.$?.["android:scheme"] === DEBUG_ID
        ) {
          data.$["android:scheme"] = "${appAuthScheme}";
        }
      }
    }
    return mod;
  });

const writeDebugAppName = (projectRoot, flavor) => {
  const directory = path.join(projectRoot, "android/app/src", flavor, "res/values");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "strings.xml"), debugStrings);
};

const withDebugLauncherName = (config) =>
  withDangerousMod(config, [
    "android",
    (mod) => {
      writeDebugAppName(mod.modRequest.projectRoot, "debug");
      writeDebugAppName(mod.modRequest.projectRoot, "debugOptimized");
      return mod;
    },
  ]);

module.exports = (config) =>
  withDebugLauncherName(withDebugManifestPlaceholders(withDebugApplicationId(config)));
