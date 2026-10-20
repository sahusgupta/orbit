const path = require('path');
const { installWindowsDirectoryEntryFix } = require('./scripts/windows-directory-entries.cjs');

// Normalize Windows cloud reparse entries before Expo's file map crawls them.
installWindowsDirectoryEntryFix();

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const defaultResolveRequest = config.resolver.resolveRequest;
const performanceOverlayShim = path.join(__dirname, 'src', 'shims', 'PerformanceOverlay.js');

config.watchFolders = [
  ...(config.watchFolders || []),
  path.join(__dirname, '..', 'apps', 'api', 'src', 'shared'),
  path.join(__dirname, 'node_modules', 'expo', 'node_modules', '@expo', 'cli')
];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && /(?:^|[\\/])MapView$/.test(moduleName)) {
    return {
      type: 'sourceFile',
      filePath: path.join(__dirname, 'src', 'components', 'MapView.web.tsx')
    };
  }

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
