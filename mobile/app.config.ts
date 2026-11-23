/**
 * `app.json`, plus what only a development build may carry.
 *
 * A development build loads its JavaScript from Metro on the Mac, over the local
 * network, and iOS asks for local-network access first: hence the usage string and
 * the Bonjour services Metro is found by. A release build bundles its JavaScript and
 * never looks on the local network, and App Review asks about a permission an app
 * declares but doesn't need, so a release build goes without them.
 *
 * Decided at **prebuild**, not per Xcode configuration: `ios/` is generated once and
 * its Info.plist serves Debug and Release alike. So a release build is prebuilt as
 * one, `APP_VARIANT=production npm run prebuild` (an EAS build with the `production`
 * profile counts too), and a development build needs nothing: the entries are in by
 * default, as they were when they lived in `app.json`.
 */
import type { ConfigContext, ExpoConfig } from "expo/config";

const isRelease =
  process.env.APP_VARIANT === "production" || process.env.EAS_BUILD_PROFILE === "production";

const DEVELOPMENT_INFO_PLIST = {
  NSLocalNetworkUsageDescription:
    "Railway Logbook connects to the development server on your local network while it is being developed.",
  NSBonjourServices: ["_expo._tcp", "_expo-dev-server._tcp"],
};

export default ({ config }: ConfigContext): ExpoConfig => {
  // `app.json` names the app, so these are there
  const base = config as ExpoConfig;
  if (isRelease) return base;
  return {
    ...base,
    ios: {
      ...base.ios,
      infoPlist: { ...base.ios?.infoPlist, ...DEVELOPMENT_INFO_PLIST },
    },
  };
};
