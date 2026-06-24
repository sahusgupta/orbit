const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const defaultResolveRequest = config.resolver.resolveRequest;
const performanceOverlayShim = path.join(__dirname, 'src', 'shims', 'PerformanceOverlay.js');

config.watchFolders = [
  ...(config.watchFolders || []),
  path.join(__dirname, 'node_modules', 'expo', 'node_modules', '@expo', 'cli')
];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === '../perfmonitor/PerformanceOverlay' &&
    context.originModulePath.endsWith(path.join('elementinspector', 'InspectorPanel.js'))
  ) {
    return {
      type: 'sourceFile',
      filePath: performanceOverlayShim
    };
  }

  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
