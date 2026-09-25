// Learn more: https://docs.expo.dev/guides/monorepos/
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const projectRoot = __dirname;
/** The Next.js app one level up. Its `src/lib` is shared source; its `node_modules` is not. */
const webRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// The web app's `src/lib` is imported directly (see `@shared/*` in tsconfig.json), so
// Metro has to watch and resolve files outside the project root.
config.watchFolders = [path.resolve(webRoot, "src/lib")];

// Metro resolves a missing module by walking *up* the directory tree, which from here
// reaches the Next.js app's `node_modules` and its different React. Block that one
// directory rather than setting `disableHierarchicalLookup`: npm nests some of expo's
// own sub-dependencies (`expo-asset`, `@expo/log-box`, …) under
// `node_modules/expo/node_modules/`, and disabling the walk entirely stops those
// resolving too.
config.resolver.blockList = [
  new RegExp(`^${escapeRegExp(path.resolve(webRoot, "node_modules"))}/.*`),
];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = withNativeWind(config, { input: "./global.css" });
