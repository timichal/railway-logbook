// Metro config for the Phase 0 spike.
//
// The spike lives *inside* the Next.js repo, which has its own `node_modules`
// one level up carrying a different React (19.2.8) and TypeScript than Expo SDK
// 57 pins. Node resolution walks upward, so without this Metro can resolve
// `react` out of the parent tree and the app dies at startup with the "two
// copies of React" invariant. Pinning `nodeModulesPaths` to the spike's own
// folder and `watchFolders` to the spike root keeps the two dependency trees
// from seeing each other.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

config.watchFolders = [projectRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
