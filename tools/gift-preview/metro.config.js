const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const repositoryRoot = path.resolve(__dirname, "../..");
const config = getDefaultConfig(__dirname);
config.watchFolders = [repositoryRoot];
config.resolver.nodeModulesPaths = [path.join(repositoryRoot, "node_modules")];
module.exports = config;
