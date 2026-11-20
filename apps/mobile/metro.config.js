// The app is not an npm workspace (React Native stays out of the server build), but it shares the
// website's texts (packages/i18n) and constants (packages/shared) as source. Metro watches those
// folders; their imports (intl-messageformat) resolve from this app's own node_modules.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const packages = path.resolve(__dirname, '../../packages');

config.watchFolders = [...(config.watchFolders ?? []), packages];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
config.resolver.extraNodeModules = {
  '@parkshield/i18n': path.join(packages, 'i18n/src'),
};

module.exports = config;
