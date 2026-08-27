// Metro config for the Phase 0 spike.
//
// The spike lives *inside* the Next.js repo, which has its own `node_modules`
// one level up carrying a different React (19.2.8) and TypeScript than Expo SDK
// 57 pins. Node resolution walks upward, so without this Metro can resolve
// `react` out of the parent tree and the app dies at startup with the "two
// copies of React" invariant.
//
// `disableHierarchicalLookup` was tried first, but it also blocks Metro from
// looking inside *nested* node_modules (e.g. `expo/node_modules/@expo/log-box`,
// `expo/node_modules/expo-asset`) — npm nests a bunch of expo's own
// sub-dependencies there rather than hoisting them, so that setting broke
// those instead. A `blockList` on just the parent repo's node_modules is
// narrower: it stops Metro from ever reaching the conflicting React one level
// up, while leaving normal (including nested) node_modules resolution intact.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const parentNodeModules = path.resolve(projectRoot, "..", "node_modules");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [projectRoot];
config.resolver.blockList = new RegExp(
  `^${parentNodeModules.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/.*$`,
);

module.exports = config;
