import { describe, expect, it } from 'vitest';
import { assertMapArtifact, assertMapGuest, assertMapOptions, assertVenueDeck, fixtureFrontCard, installedMapApkPath, mapArtifactPolicy,
  mapFixtureVenues, selectMapNode, usableMapNode, isRestorableMapDisplaySettings, mapDisplayRestorationCommands, isEmptyMapField } from '../tests/e2e/player-android-qa/mapHandoffSmoke.mjs';
import { createDemoPlayerData } from '../player-app/src/demo/demoPlayerData';
import { buildMatchCandidates, rankMatchCandidates } from '../player-app/src/domain/orbitMatchCandidates';
import { defaultMatchPreferences } from '../player-app/src/domain/orbitMatchTypes';
import { connectedFrontGame } from '../tests/e2e/player-android-qa/connectedSmoke.mjs';

const policy = { sourceSha256: 'a'.repeat(64), sourceFiles: 128, apkSha256: 'b'.repeat(64), apkBytes: 123 };
const source = { sha256: policy.sourceSha256, files: 128 };
const evidence = () => ({ actualSha256: policy.apkSha256, actualBytes: 123,
  metadata: { appId: 'com.orbit.player.qa', sha256: policy.apkSha256, bytes: 123, source }, recordedSource: source, currentSource: source,
  approvals: { offline: '1', apk: policy.apkSha256, source: policy.sourceSha256 }, ordinaryPath: true, metadataPathMatches: true });
const offline = () => ({ state: 'device\n', emulator: '1\n', boot: '1\n', avd: 'orbit_match_qa\nOK\n', airplane: '1', wifi: '0', mobile: '0',
  routes: '', routes6: 'fe80::/64 dev eth0', links: '2: eth0: <BROADCAST> mtu 1500 state DOWN\n3: wlan0: <BROADCAST> mtu 1500 state DOWN',
  connectivity: 'Active default network: none', reverses: '' });
const display = { width: 1080, height: 2400, density: 2.625 };
const node = (label, extra = {}) => ({ package: 'com.orbit.player.qa', 'content-desc': label, enabled: 'true', clickable: 'true', rect: [30, 300, 1030, 600], ...extra });
const saved = { game: '1/3 No Limit Holdem', venue: 'Cloud Nine Card House' };

describe('current-source offline Android Map QA guards', () => {
  it('requires the exact approved current APK and rejects the historical baseline', () => {
    expect(mapArtifactPolicy.sourceSha256).toBe('6d4b38106a72fbaaaa95eb6e7d26067b027bca07693100142dc6cc0b56c71342');
    expect(() => assertMapArtifact(mapArtifactPolicy, evidence())).toThrow();
    const old = evidence();
    old.actualSha256 = old.metadata.sha256 = old.approvals.apk = 'edaae05de85f38a891e0f25d28df3ff07ad1ee0235be1cc8d8c52d29af631295';
    old.actualBytes = old.metadata.bytes = 45803051;
    old.metadata.source = old.recordedSource = old.currentSource = { sha256: '82f64bce7402e3a5f5886b258d4c87ba851011e02ccbd170dd0523bffdf53060', files: 128 };
    old.approvals.source = old.metadata.source.sha256;
    expect(() => assertMapArtifact(mapArtifactPolicy, old)).toThrow();
    expect(assertMapArtifact(policy, evidence())).toBe(true);
  });

  it('requires source agreement across metadata, recorded snapshot and freshly recomputed repository', () => {
    for (const key of ['recordedSource', 'currentSource']) {
      expect(() => assertMapArtifact(policy, { ...evidence(), [key]: { ...source, sha256: 'c'.repeat(64) } })).toThrow();
      expect(() => assertMapArtifact(policy, { ...evidence(), [key]: { ...source, files: 127 } })).toThrow();
    }
    const item = evidence(); item.metadata.source = { ...source, sha256: 'c'.repeat(64) };
    expect(() => assertMapArtifact(policy, item)).toThrow();
  });

  it('rejects a mismatched APK, app identity, path alias or incomplete root approval', () => {
    for (const change of [{ actualSha256: 'c'.repeat(64) }, { actualBytes: 124 }, { ordinaryPath: false }, { metadataPathMatches: false },
      { approvals: { ...evidence().approvals, offline: '0' } }, { approvals: { ...evidence().approvals, apk: 'c'.repeat(64) } },
      { approvals: { ...evidence().approvals, source: 'c'.repeat(64) } }]) {
      expect(() => assertMapArtifact(policy, { ...evidence(), ...change })).toThrow();
    }
    const item = evidence(); item.metadata.appId = 'com.orbit.player.qa.connected';
    expect(() => assertMapArtifact(policy, item)).toThrow();
  });

  it('allows only explicit bounded options and preserves guest data', () => {
    expect(assertMapOptions(new Set())).toBe(true);
    expect(assertMapOptions(new Set(['--run', '--install', '--measure-gestures']))).toBe(true);
    for (const option of ['--fresh', '--resume-last-two', '--demo-sanity', '--seat-request', '--path=x', '--serial=emulator-5554', '--port=5037']) {
      expect(() => assertMapOptions(new Set(['--run', option]))).toThrow();
    }
    expect(() => assertMapOptions(new Set(['--measure-gestures']))).toThrow();
  });

  it('requires the exact AVD, explicit down interfaces and no reverse bridge', () => {
    expect(assertMapGuest(offline())).toBe(true);
    for (const change of [{ avd: 'other\nOK' }, { avd: '' }, { reverses: 'emulator-5580 tcp:14639 tcp:14639' }, { links: '' },
      { links: '2: eth0: state DOWN' }, { links: '2: eth0: state UP\n3: wlan0: state DOWN' }]) {
      expect(() => assertMapGuest({ ...offline(), ...change })).toThrow();
    }
  });

  it('retains all existing offline preconditions', () => {
    for (const change of [{ state: 'offline' }, { emulator: '0' }, { boot: '0' }, { airplane: '0' }, { wifi: '1' }, { mobile: '1' },
      { routes: 'default via 10.0.2.2' }, { routes6: 'default via fe80::1' }, { connectivity: 'Active default network: 100' }]) {
      expect(() => assertMapGuest({ ...offline(), ...change })).toThrow();
    }
  });

  it('accepts the observed Windows ADB CRCRLF framing while keeping the exact AVD name', () => {
    expect(assertMapGuest({ ...offline(), avd: 'orbit_match_qa\r\r\nOK\r\r\n' })).toBe(true);
    expect(() => assertMapGuest({ ...offline(), avd: 'other\r\r\nOK\r\r\n' })).toThrow();
  });

  it('retains Android default display values reported as null for later observed-value restoration', () => {
    expect(isRestorableMapDisplaySettings({ night: 'Night mode: no', font: '1.0', window: '1.0', transition: '1.0', animator: 'null' })).toBe(true);
  });

  it('rejects unknown display values and night commands', () => {
    const settings = { night: 'Night mode: no', font: '1', window: '1', transition: '1', animator: '1' };
    expect(isRestorableMapDisplaySettings(settings)).toBe(true);
    for (const change of [{ animator: 'undefined' }, { animator: '1; reboot' }, { font: 'NaN' }, { night: 'Night mode: other' }]) {
      expect(isRestorableMapDisplaySettings({ ...settings, ...change })).toBe(false);
    }
  });

  it('restores present numeric display values without changing their representation', () => {
    expect(mapDisplayRestorationCommands({ night: 'Night mode: auto', font: '1.0', window: '0.5', transition: '1', animator: '0' })).toEqual([
      ['cmd', 'uimode', 'night', 'auto'], ['settings', 'put', 'system', 'font_scale', '1.0'],
      ['settings', 'put', 'global', 'window_animation_scale', '0.5'], ['settings', 'put', 'global', 'transition_animation_scale', '1'],
      ['settings', 'put', 'global', 'animator_duration_scale', '0']
    ]);
    expect(() => mapDisplayRestorationCommands({ night: 'Night mode: unknown' })).toThrow();
  });

  it('deletes absent display values instead of persisting the literal null sentinel', () => {
    expect(mapDisplayRestorationCommands({ night: 'Night mode: no', font: 'null', window: 'null', transition: 'null', animator: 'null' })).toEqual([
      ['cmd', 'uimode', 'night', 'no'], ['settings', 'delete', 'system', 'font_scale'],
      ['settings', 'delete', 'global', 'window_animation_scale'], ['settings', 'delete', 'global', 'transition_animation_scale'],
      ['settings', 'delete', 'global', 'animator_duration_scale']
    ]);
  });

  it('recognizes the exact empty Android placeholder representation for the two QA fields', () => {
    for (const hint of ['Games, clubs, or stakes', 'Stakes']) {
      const field = node(hint === 'Stakes' ? 'Stakes' : '', { class: 'android.widget.EditText', hint, text: '' });
      expect(isEmptyMapField(field, display, hint)).toBe(true);
      expect(isEmptyMapField({ ...field, text: hint }, display, hint)).toBe(true);
    }
  });

  it('never mistakes retained input, malformed fields or a clipped Clear control for an empty query', () => {
    const hint = 'Games, clubs, or stakes', field = node('', { class: 'android.widget.EditText', hint, text: '' });
    for (const change of [{ text: 'MAP_QA_NO_MATCH' }, { hint: undefined }, { hint: 'Unknown' }, { package: 'com.other' }, { class: 'android.widget.TextView' }, { rect: [-1, 0, 200, 100] }]) {
      expect(isEmptyMapField({ ...field, ...change }, display, hint)).toBe(false);
    }
    expect(isEmptyMapField(field, display, hint, [node('Clear game search', { rect: [30, 2401, 1030, 2490], enabled: 'false' })])).toBe(false);
    expect(isEmptyMapField(node('Stakes', { class: 'android.widget.EditText', hint: 'Stakes', text: '999' }), display, 'Stakes')).toBe(false);
    expect(isEmptyMapField(node('Other', { class: 'android.widget.EditText', hint: 'Stakes', text: '' }), display, 'Stakes')).toBe(false);
  });

  it('never taps an OS/foreign, disabled, clipped or inverted target', () => {
    expect(usableMapNode(node('Map'), display, { press: true, minHeightDp: 40 })).toBe(true);
    for (const change of [{ package: 'android' }, { package: 'com.google.android.permissioncontroller' }, { enabled: 'false' },
      { clickable: 'false' }, { rect: [30, 2302, 245, 2166] }, { rect: [30, 2300, 1030, 2450] }, { rect: [-1, 300, 1030, 600] }, { rect: [30, 300, 1030, 350] }]) {
      expect(usableMapNode(node('Map', change), display, { press: true, minHeightDp: 40 })).toBe(false);
    }
  });

  it('distinguishes a labeled field from its visible text and allows disabled geometry only for observation', () => {
    expect(usableMapNode(node('Stakes'), display, { field: true })).toBe(false);
    expect(usableMapNode(node('Stakes', { class: 'android.widget.EditText' }), display, { field: true })).toBe(true);
    expect(usableMapNode(node('Undo last swipe', { enabled: 'false' }), display, { enabled: false })).toBe(true);
    expect(usableMapNode(node('Undo last swipe', { enabled: 'false' }), display, { press: true })).toBe(false);
  });

  it('waits for the actual selected state and selects the close button rather than its same-label modal backdrop', () => {
    const backdrop = node('Close game search', { rect: [0, 0, 1080, 2400] });
    const close = node('Close game search', { rect: [800, 300, 920, 420] });
    expect(selectMapNode([backdrop, close], display, 'Close game search', { press: true, minHeightDp: 40 })).toBe(close);
    expect(selectMapNode([node('All', { selected: 'false' })], display, 'All', { selected: 'true' })).toBeUndefined();
    expect(selectMapNode([node('All', { selected: 'true' })], display, 'All', { selected: 'true' })).toBeDefined();
  });

  it('selects the actual front candidate rather than assuming ranking order', () => {
    const plo = { game: '2/5 Pot Limit Omaha', venue: 'Wonderland Card House', label: 'Open 2/5 Pot Limit Omaha at Wonderland Card House' };
    expect(fixtureFrontCard([node(plo.label)], display)).toEqual(plo);
    expect(() => fixtureFrontCard([node(plo.label), node('Open 1/3 No Limit Holdem at Cloud Nine Card House')], display)).toThrow();
    expect(() => fixtureFrontCard([node(plo.label, { package: 'com.other' })], display)).toThrow();
  });

  it('retains exact fixture identity and the full accessible name when primary facts follow the summary separator', () => {
    const card = { game: '2/5 Pot Limit Omaha', venue: 'Wonderland Card House',
      label: 'Open 2/5 Pot Limit Omaha at Wonderland Card House; OMAHA; 3 seats open; Austin \u00b7 2.4 mi away' };
    expect(fixtureFrontCard([node(card.label)], display)).toEqual(card);
    expect(() => fixtureFrontCard([node(card.label), node('Open 1/3 No Limit Holdem at Cloud Nine Card House; HOLD\u2019EM; 1 seat open')], display)).toThrow();
    for (const extra of [{ package: 'com.other' }, { enabled: 'false' }, { clickable: 'false' }, { rect: [30, 2300, 1030, 2450] }]) {
      expect(() => fixtureFrontCard([node(card.label, extra)], display)).toThrow();
    }
  });

  it('rejects a changed game or venue prefix and a summary without the explicit separator', () => {
    for (const label of ['Save 2/5 Pot Limit Omaha at Wonderland Card House; OMAHA',
      'Open 2/5 Pot Limit Omaha extra at Wonderland Card House; OMAHA',
      'Open 2/5 Pot Limit Omaha at Wonderland Card House extra; OMAHA',
      'Open 2/5 Pot Limit Omaha at Other venue; OMAHA',
      'Open 2/5 Pot Limit Omaha at Wonderland Card House OMAHA',
      'Open 2/5 Pot Limit Omaha at Wonderland Card House; ',
      'Open 2/5 Pot Limit Omaha at Wonderland Card House; OMAHA\n']) {
      expect(() => fixtureFrontCard([node(label)], display)).toThrow();
    }
  });

  it('extracts only the exact connected game capture from either supported card-name shape', () => {
    for (const game of ['$1/$2 No Limit Holdem', '$2/$5 Pot Limit Omaha']) {
      const label = `Open ${game} at Native QA Card House`;
      expect(connectedFrontGame(node(label))).toBe(game);
      expect(connectedFrontGame(node(label + '; HOLD\u2019EM; 3 seats open; Austin \u00b7 6.2 mi away'))).toBe(game);
    }
    for (const label of ['Save $1/$2 No Limit Holdem at Native QA Card House; HOLD\u2019EM',
      'Open $5/$10 No Limit Holdem at Native QA Card House; HOLD\u2019EM',
      'Open $1/$2 No Limit Holdem extra at Native QA Card House; HOLD\u2019EM',
      'Open $1/$2 No Limit Holdem at Other venue; HOLD\u2019EM',
      'Open $1/$2 No Limit Holdem at Native QA Card House extra; HOLD\u2019EM',
      'Open $1/$2 No Limit Holdem at Native QA Card House HOLD\u2019EM',
      'Open $1/$2 No Limit Holdem at Native QA Card House; ',
      'Open $1/$2 No Limit Holdem at Native QA Card House; HOLD\u2019EM\n']) {
      expect(connectedFrontGame(node(label))).toBeNull();
    }
    expect(connectedFrontGame({})).toBeNull();
  });

  it('rejects paused/active-request games and foreign venues as front-card fixtures', () => {
    for (const label of ['Open 4/8 Mixed Games at Cloud Nine Card House', 'Open 1/2 No Limit Holdem at Wonderland Card House', 'Open 1/2 No Limit Holdem at Real venue']) {
      expect(() => fixtureFrontCard([node(label)], display)).toThrow();
    }
  });

  it('requires the complete eligible target set and detects duplicates or a foreign-venue leak', () => {
    const venue = mapFixtureVenues[2];
    const observed = venue.games.map(game => ({ game, venue: venue.name }));
    expect(assertVenueDeck(venue.name, observed, saved)).toEqual([...venue.games].sort());
    expect(() => assertVenueDeck(venue.name, observed.slice(1), saved)).toThrow();
    expect(() => assertVenueDeck(venue.name, [observed[0], observed[0]], saved)).toThrow();
    expect(() => assertVenueDeck(venue.name, observed.map(item => ({ ...item, venue: saved.venue })), saved)).toThrow();
    expect(() => assertVenueDeck('Real venue', [], saved)).toThrow();
  });

  it('keeps the saved record out of Discover without imposing a synthetic storage cap', () => {
    const venue = mapFixtureVenues[0], retained = { game: venue.games[0], venue: venue.name };
    expect(assertVenueDeck(venue.name, venue.games.slice(1).map(game => ({ game, venue: venue.name })), retained)).toEqual(venue.games.slice(1).sort());
    expect(() => assertVenueDeck(venue.name, venue.games.map(game => ({ game, venue: venue.name })), retained)).toThrow();
  });

  it('matches the actual demo generator and ranking eligibility, including scheduled events', () => {
    const nowMs = Date.parse('2026-10-13T12:00:00Z'), demo = createDemoPlayerData(nowMs);
    const candidates = buildMatchCandidates({ ...demo, player: demo.player, nowMs, origin: null, activeGameKeys: new Set(['demo-austin:demo-austin-nlh-1-2']) });
    const actual = rankMatchCandidates({ candidates, preferences: defaultMatchPreferences, decisions: [] });
    expect(actual).toHaveLength(10);
    for (const venue of mapFixtureVenues) {
      const club = demo.clubs.find(item => item.club.name === venue.name);
      expect(club?.club.address).toBe(`Fictional venue, ${venue.city}`);
      expect(actual.filter(item => item.summary.venueName === venue.name).map(item => item.summary.gameName).sort()).toEqual([...venue.games].sort());
    }
  });

  it('inspects only the installed QA base APK and rejects foreign, split, traversal or extra paths', () => {
    const valid = 'package:/data/app/~~test/com.orbit.player.qa-123/base.apk\n';
    expect(installedMapApkPath(valid)).toBe(valid.trim().slice(8));
    for (const value of [valid + valid, valid.replace('qa-123', 'qa.connected-123'), valid.replace('base.apk', 'split.apk'), valid.replace('~~test', '..'), '/sdcard/anything.apk']) {
      expect(() => installedMapApkPath(value)).toThrow();
    }
  });
});
