import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { adbArguments, assertDemoSanityArtifact, assertDemoSanityOptions, assertGuestOffline, assertResumeEvidence, createSmokeEnvironment, fixtureInput, isAllowedPermissionDenial, nodeMatches, parseHierarchy, qaTarget } from './smoke.mjs';

const offline = () => ({ state: 'device\n', emulator: '1\n', boot: '1\n', airplane: '1\n', wifi: '0\n', mobile: '0\n', routes: '', routes6: '::1 dev lo\n', links: '2: eth0: <BROADCAST> mtu 1500 state DOWN\n3: wlan0: <BROADCAST> mtu 1500 state DOWN', connectivity: 'Active default network: none\n' });

describe('Android engineering smoke isolation and UI selectors', () => {
  it('pins current demo sanity to the reviewed rebuilt baseline and preserves the existing guest', () => {
    expect(assertDemoSanityOptions(new Set(['--run','--install','--demo-sanity']))).toBe(true);
    for (const options of [['--run','--demo-sanity','--fresh'],['--run','--demo-sanity','--resume-last-two'],['--demo-sanity'],['--run']]) expect(() => assertDemoSanityOptions(new Set(options))).toThrow();
    const digest = 'edaae05de85f38a891e0f25d28df3ff07ad1ee0235be1cc8d8c52d29af631295';
    const source = {sha256:'82f64bce7402e3a5f5886b258d4c87ba851011e02ccbd170dd0523bffdf53060',files:128};
    expect(assertDemoSanityArtifact(digest,source)).toBe(true);
    expect(() => assertDemoSanityArtifact('0'.repeat(64),source)).toThrow();
    expect(() => assertDemoSanityArtifact(digest,{...source,sha256:'0'.repeat(64)})).toThrow();
    expect(() => assertDemoSanityArtifact(digest,{...source,files:129})).toThrow();
  });
  it('pins every ADB invocation to the dedicated port and emulator', () => {
    expect(qaTarget).toEqual({ package: 'com.orbit.player.qa', serial: 'emulator-5580', port: '5039', activity: 'com.orbit.player.qa/.MainActivity' });
    expect(adbArguments(['shell', 'am', 'force-stop', qaTarget.package])).toEqual(['-P', '5039', '-s', 'emulator-5580', 'shell', 'am', 'force-stop', 'com.orbit.player.qa']);
    expect(Object.isFrozen(qaTarget)).toBe(true);
  });
  it('uses QA-only Android and ADB homes without inheriting credentials', () => {
    const root = path.resolve('out/test-native');
    const environment = createSmokeEnvironment({ Path: 'tools', SystemRoot: 'C:/Windows', USERPROFILE: 'host', ADB_VENDOR_KEYS: 'host-secret', GOOGLE_APPLICATION_CREDENTIALS: 'private', EXPO_TOKEN: 'private' }, root);
    expect(environment.Path).toBe('tools');
    expect(environment.ADB_SERVER_SOCKET).toBe('tcp:127.0.0.1:5039');
    expect(environment.ADB_VENDOR_KEYS).toBe(path.join(root, 'android-user/adbkey'));
    expect(environment.ANDROID_USER_HOME).toBe(path.join(root, 'android-user'));
    expect(environment.USERPROFILE).toBe(path.join(root, 'user-home'));
    expect(environment.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
    expect(environment.EXPO_TOKEN).toBeUndefined();
  });
  it('requires all offline signals before permitting any app action', () => {
    expect(assertGuestOffline(offline())).toBe(true);
    for (const [field, value] of Object.entries({ state: 'offline', emulator: '0', boot: '0', airplane: '0', wifi: '1', mobile: '1', routes: '10.0.2.0/24 dev eth0', routes6: 'default via fe80::1', links: '2: eth0: <UP> state UP', connectivity: 'Active default network: 100' })) {
      expect(() => assertGuestOffline({ ...offline(), [field]: value }), field).toThrow();
    }
  });
  it('parses native accessibility labels, bounds and nested clickable parents', () => {
    const nodes = parseHierarchy('<?xml version="1.0"?><hierarchy><node package="com.orbit.player.qa" bounds="[0,0][1080,2400]"><node clickable="true" content-desc="Save Holdem &amp; Omaha" enabled="true" bounds="[24,120][400,252]"><node text="Save" bounds="[40,140][100,180]"/></node></node></hierarchy>');
    expect(nodes).toHaveLength(3);
    expect(nodes[1]['content-desc']).toBe('Save Holdem & Omaha');
    expect(nodes[1].rect).toEqual([24, 120, 400, 252]);
    expect(nodes[2].parent).toBe(nodes[1]);
    expect(nodeMatches(nodes[1], /^Save /)).toBe(true);
    expect(nodeMatches(nodes[2], 'Save')).toBe(true);
    expect(nodeMatches(nodes[1], 'Remove')).toBe(false);
    expect(nodeMatches({ 'content-desc': '\uE100, Request a seat' }, 'Request a seat')).toBe(true);
    expect(() => parseHierarchy('UI dump failed')).toThrow(/hierarchy/);
  });
  it('decodes XML numeric characters and exact selection state', () => {
    const [node] = parseHierarchy('<hierarchy><node text="&#x53;aved &#38; games" content-desc="Saved games, 1" checked="true" bounds="[1,2][3,4]"/></hierarchy>');
    expect(node.text).toBe('Saved & games');
    expect(node.checked).toBe('true');
    expect(nodeMatches(node, 'Saved games, 1')).toBe(true);
  });
  it('permits only bounded synthetic fixture input, never shell metacharacters', () => {
    expect(fixtureInput('Android QA Fixture')).toBe('Android%sQA%sFixture');
    expect(fixtureInput('android.qa@example.invalid')).toBe('android.qa@example.invalid');
    expect(fixtureInput('-97.7431')).toBe('-97.7431');
    for (const value of ['test; command', '$(token)', '`token`', 'name\ncommand', 'x'.repeat(101)]) expect(() => fixtureInput(value)).toThrow();
  });
  it('allows only the exact permission-controller denial for this QA app location request', () => {
    const context = [{ package: 'com.google.android.permissioncontroller', text: "Allow Orbit Player QA to access this device's location?" }];
    const denial = { package: 'com.google.android.permissioncontroller', 'resource-id': 'com.google.android.permissioncontroller:id/permission_deny_button', text: "Don't allow", clickable: 'true', enabled: 'true' };
    expect(isAllowedPermissionDenial(denial, context)).toBe(true);
    expect(isAllowedPermissionDenial({ ...denial, text: 'Don\u2019t allow', 'resource-id': 'com.android.permissioncontroller:id/permission_deny_button' }, context)).toBe(true);
    for (const change of [{ package: 'com.orbit.player' }, { package: 'com.android.permissioncontroller' }, { text: 'Allow' }, { text: 'While using the app' }, { 'resource-id': 'com.google.android.permissioncontroller:id/permission_allow_foreground_only_button' }, { 'resource-id': 'com.android.permissioncontroller:id/permission_allow_one_time_button' }, { 'resource-id': 'other.namespace:id/permission_deny_button' }, { clickable: 'false' }, { enabled: 'false' }]) expect(isAllowedPermissionDenial({ ...denial, ...change }, context)).toBe(false);
    expect(isAllowedPermissionDenial(denial, [{ ...context[0], text: 'Allow Other App to access location?' }])).toBe(false);
    expect(isAllowedPermissionDenial(denial, [{ ...context[0], text: 'Allow Orbit Player QA to access your camera?' }])).toBe(false);
  });
  it('resumes only the preserved final-artifact sixteen passes after the exact selector mismatch', () => {
    const prior = { status: 'failed', settingsRestored: true, target: qaTarget,
      apkSha256: '918109df71ec8cf83d54d32561493888c509c31aabfc1d42c414e61ca73ccc78',
      sourceFingerprint: { sha256: 'fbd9caea8f7f0786c4c0ba9b85f1ddbfcb427edec673fe2493f1bf59976c83f5', files: 128 },
      checks: Array.from({ length: 16 }, (_, index) => ({ status: 'passed', name: index === 15 ? 'local Match preferences and manual origin persist across native cold relaunch' : `case-${index}` })),
      failure: 'Expected the exact Android QA location permission denial button; no other OS action is allowed.' };
    expect(assertResumeEvidence(prior)).toBe(true);
    for (const change of [{ status: 'passed' }, { settingsRestored: false }, { apkSha256: '0'.repeat(64) }, { sourceFingerprint: { ...prior.sourceFingerprint, sha256: '0'.repeat(64) } }, { checks: prior.checks.slice(1) }, { checks: prior.checks.map((check, index) => index === 1 ? { ...check, status: 'failed' } : check) }, { failure: 'An actual app regression' }, { target: { ...qaTarget, serial: 'emulator-5554' } }]) expect(() => assertResumeEvidence({ ...prior, ...change })).toThrow(/Resume/);
  });
});
