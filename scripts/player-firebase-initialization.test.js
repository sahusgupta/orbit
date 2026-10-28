import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { ensureSwiftFirebaseInitialization } = require('../player-app/plugins/with-firebase-scene-initialization.cjs');
const { modifySwiftAppDelegate: initializeFirebase } = require('../player-app/node_modules/@react-native-firebase/app/plugin/build/ios/appDelegate.js');
const {
  modifySwiftAppDelegate: initializeAppCheck,
  modifySwiftBridgingHeaderContents
} = require('../player-app/node_modules/@react-native-firebase/app-check/plugin/build/ios/appDelegate.js');

const factoryCall = 'RNFBAppCheckModule.sharedInstance()';
const firebaseCall = 'FirebaseApp.configure()';
const launchReturn = 'return super.application(application, didFinishLaunchingWithOptions: launchOptions)';

function delegateFixture({ sceneLifecycle = false } = {}) {
  return `${sceneLifecycle ? 'internal import Expo' : 'import Expo'}
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate${sceneLifecycle ? ', ExpoReactNativeFactoryProvider' : ''} {
  var window: UIWindow?
  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()
    reactNativeDelegate = delegate
    reactNativeFactory = factory
${sceneLifecycle ? '' : `    bindReactNativeFactory(factory)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)
`}
    ${launchReturn}
  }
}
class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {}
`;
}

// Expo executes the later registered App Check dangerous mod first. It installs
// both calls; the Firebase mod then supplies its import without configuring twice.
function upstreamInitialization(contents) {
  return initializeFirebase(initializeAppCheck(contents));
}

function expectInitialization(contents, startup) {
  expect(contents).toContain('import FirebaseCore');
  expect(contents.split(factoryCall)).toHaveLength(2);
  expect(contents.split(firebaseCall)).toHaveLength(2);
  expect(contents.indexOf(factoryCall)).toBeLessThan(contents.indexOf(firebaseCall));
  expect(contents.indexOf(firebaseCall)).toBeLessThan(contents.indexOf(startup));
}

describe('Player native Firebase initialization characterization', () => {
  it('registers the provider before Firebase and React Native startup in the SDK 57 delegate', () => {
    expectInitialization(upstreamInitialization(delegateFixture()), 'factory.startReactNative(');
  });

  it('preserves exactly one provider registration and Firebase configuration on repeat application', () => {
    const once = upstreamInitialization(delegateFixture());
    expect(upstreamInitialization(once)).toBe(once);
    expectInitialization(once, 'factory.startReactNative(');
  });

  it('exposes the Objective-C App Check class through one quoted bridging-header import', () => {
    const once = modifySwiftBridgingHeaderContents('// Existing bridging header\n');
    expect(once).toContain('#import "RNFBAppCheckModule.h"');
    expect(modifySwiftBridgingHeaderContents(once)).toBe(once);
    expect(once.split('RNFBAppCheckModule.h')).toHaveLength(2);
  });

  it('registers the provider and Firebase before scene startup in the SDK 58 delegate', () => {
    const generated = upstreamInitialization(delegateFixture({ sceneLifecycle: true }));
    const configured = ensureSwiftFirebaseInitialization(generated);
    expectInitialization(configured, launchReturn);
    expect(configured).toContain('internal import Expo');
    expect(configured.indexOf(firebaseCall)).toBeLessThan(configured.indexOf('let delegate = ReactNativeDelegate()'));
    expect(ensureSwiftFirebaseInitialization(configured)).toBe(configured);
  });

  it('preserves the already initialized SDK 57 delegate without rewriting it', () => {
    const configured = upstreamInitialization(delegateFixture());
    expect(ensureSwiftFirebaseInitialization(configured)).toBe(configured);
  });

  it.each([
    ['unknown startup', (source) => source.replace('reactNativeFactory = factory', 'startUnknownFactory()')],
    ['missing Firebase import', (source) => source.replace('import FirebaseCore', '')],
    ['partial initialization', (source) => source.replace('let delegate =', `${factoryCall}\n    let delegate =`)],
    ['duplicate initialization', (source) => source.replace('let delegate =', `${factoryCall}\n    ${factoryCall}\n    ${firebaseCall}\n    let delegate =`)],
    ['reversed initialization', (source) => source.replace('let delegate =', `${firebaseCall}\n    ${factoryCall}\n    let delegate =`)],
    ['comment-only initialization', (source) => source.replace('let delegate =', `// ${factoryCall}\n    // ${firebaseCall}\n    let delegate =`)],
    ['block-comment initialization', (source) => source.replace('let delegate =', `/*\n    ${factoryCall}\n    ${firebaseCall}\n    */\n    let delegate =`)],
    ['conditional initialization', (source) => source.replace('let delegate =', `if false {\n    ${factoryCall}\n    ${firebaseCall}\n    }\n    let delegate =`)],
    ['early return before initialization', (source) => source.replace('let delegate =', `return false\n    ${factoryCall}\n    ${firebaseCall}\n    let delegate =`)],
    ['initialization after startup', (source) => source.replace(launchReturn, `${launchReturn}\n    ${factoryCall}\n    ${firebaseCall}`)],
    ['unsupported Swift module import', (source) => `import RNFBAppCheck\n${source}`]
  ])('rejects %s instead of silently changing native initialization', (_name, mutate) => {
    const generated = upstreamInitialization(delegateFixture({ sceneLifecycle: true }));
    expect(() => ensureSwiftFirebaseInitialization(mutate(generated))).toThrow();
  });
});
