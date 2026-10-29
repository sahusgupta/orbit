const assert = require('node:assert/strict');
const { withAppDelegate } = require('@expo/config-plugins');

const factoryCall = 'RNFBAppCheckModule.sharedInstance()';
const firebaseCall = 'FirebaseApp.configure()';

function singleMatch(contents, expression, label) {
  const matches = [...contents.matchAll(expression)];
  assert.equal(matches.length, 1, `Unsupported Firebase AppDelegate template: expected one ${label}.`);
  return matches[0];
}

function executableSource(contents) {
  return contents.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"/g,
    (nonCode) => nonCode.replace(/[^\r\n]/g, ' '));
}

function ensureSwiftFirebaseInitialization(contents) {
  singleMatch(contents, /^(?:internal )?import Expo[ \t]*$/gm, 'Expo import');
  singleMatch(contents, /^import FirebaseCore[ \t]*$/gm, 'FirebaseCore import');
  assert.doesNotMatch(contents, /^\s*import RNFBAppCheck\b/m, 'App Check must use its Objective-C bridging header.');
  const declaration = singleMatch(contents, /^(?:public )?class AppDelegate: ExpoAppDelegate(?:, ExpoReactNativeFactoryProvider)? \{[ \t]*$/gm, 'Expo app delegate');
  const launch = singleMatch(contents, /  public override func application\(\s+_ application: UIApplication,\s+didFinishLaunchingWithOptions launchOptions: \[UIApplication\.LaunchOptionsKey: Any\]\? = nil\s+\) -> Bool \{/g, 'application launch method');
  const delegate = singleMatch(contents, /^([ \t]*)let delegate = ReactNativeDelegate\(\)[ \t]*$/gm, 'React Native delegate creation');
  const factory = singleMatch(contents, /^[ \t]*let factory = ExpoReactNativeFactory\(delegate: delegate\)[ \t]*$/gm, 'React Native factory creation');
  const assignment = singleMatch(contents, /^[ \t]*reactNativeFactory = factory[ \t]*$/gm, 'React Native factory assignment');
  const returned = singleMatch(contents, /^[ \t]*return super\.application\(application, didFinishLaunchingWithOptions: launchOptions\)[ \t]*$/gm, 'application launch return');
  assert.ok(declaration.index < launch.index && launch.index < delegate.index && delegate.index < factory.index
    && factory.index < assignment.index && assignment.index < returned.index,
  'Unsupported Firebase AppDelegate template: launch statements have changed order.');

  const starts = [...contents.matchAll(/\bfactory\.startReactNative\(/g)];
  const sceneLifecycle = declaration[0].includes('ExpoReactNativeFactoryProvider');
  assert.ok(sceneLifecycle ? starts.length === 0 : starts.length === 1,
    'Unsupported Firebase AppDelegate template: React Native startup is not recognized.');
  const startup = sceneLifecycle ? returned.index : starts[0].index;
  assert.ok(startup > assignment.index && startup <= returned.index,
    'Unsupported Firebase AppDelegate template: React Native startup moved outside application launch.');

  const factories = [...contents.matchAll(/\bRNFBAppCheckModule\.sharedInstance\s*\(/g)];
  const configurations = [...contents.matchAll(/\bFirebaseApp\.configure\s*\(/g)];
  if (factories.length || configurations.length) {
    assert.equal(factories.length, 1, 'App Check provider must be registered exactly once.');
    assert.equal(configurations.length, 1, 'Firebase must be configured exactly once.');
    const executable = executableSource(contents);
    const provider = singleMatch(executable, /^[ \t]*RNFBAppCheckModule\.sharedInstance\(\)[ \t]*$/gm, 'executable provider registration statement');
    const firebase = singleMatch(executable, /^[ \t]*FirebaseApp\.configure\(\)[ \t]*$/gm, 'executable Firebase configuration statement');
    assert.ok(provider.index > launch.index && provider.index < firebase.index && firebase.index < startup,
      'App Check provider must precede Firebase configuration and native startup within application launch.');
    const prefix = executable.slice(launch.index + launch[0].length, provider.index);
    assert.doesNotMatch(prefix, /[{}]|\b(?:if|guard|switch|for|while|do|repeat|return|throw|catch|defer)\b/,
      'Firebase initialization must execute unconditionally in the straight-line launch body.');
    assert.equal(executable.slice(provider.index + provider[0].length, firebase.index).trim(), '',
      'The App Check provider and Firebase initialization must be consecutive launch statements.');
    if (sceneLifecycle) {
      assert.match(executable.slice(launch.index + launch[0].length, delegate.index),
        /^\s*RNFBAppCheckModule\.sharedInstance\(\)\s*FirebaseApp\.configure\(\)\s*$/,
        'Scene initialization must be the first straight-line launch statements.');
    }
    return contents;
  }

  assert.ok(sceneLifecycle, 'The legacy Expo template must already be initialized by the official Firebase plugins.');
  assert.equal(contents.slice(launch.index + launch[0].length, delegate.index).trim(), '',
    'Unsupported Firebase AppDelegate template: unexpected code precedes delegate creation.');
  // RNFB 26 keeps its CocoaPods, client plist, import, and bridging-header setup.
  // Its startup anchor moved to SceneDelegate in SDK 58. Register before creating
  // the React Native delegate, preserving factory -> Firebase -> native startup.
  const indent = delegate[1];
  return contents.slice(0, delegate.index)
    + `${indent}${factoryCall}\n${indent}${firebaseCall}\n\n`
    + contents.slice(delegate.index);
}

module.exports = function withFirebaseSceneInitialization(config) {
  return withAppDelegate(config, (configuration) => {
    assert.equal(configuration.modResults.language, 'swift', 'Firebase scene initialization requires the reviewed Swift delegate.');
    configuration.modResults.contents = ensureSwiftFirebaseInitialization(configuration.modResults.contents);
    return configuration;
  });
};

module.exports.ensureSwiftFirebaseInitialization = ensureSwiftFirebaseInitialization;
