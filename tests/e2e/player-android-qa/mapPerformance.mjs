import assert from 'node:assert/strict';

export const performancePackage = 'com.orbit.player.qa';
const maxDumpBytes = 2 * 1024 * 1024;
const sentinel = 9223372036854775807n;
const fixedActions = Object.freeze(Array.from({ length: 6 }, (_, index) => [index % 2 === 0 ? 'save-swipe' : 'pass-swipe', 'undo-tap']).flat());
const limitations = Object.freeze([
  'One bounded Android emulator sample using software rendering; no physical-device or 60fps acceptance.',
  'FrameCompleted minus IntendedVsync is a package rendering duration, not touch latency or presentation FPS.',
  'Gfxinfo buffers can truncate a window; renderer totals and valid CSV rows have different populations.',
  'Window wall time includes ADB input and fixed settling delays; it is not an animation duration.'
]);
const milliseconds = value => Math.round(Number(value) / 1_000) / 1_000;

export function parsePackageFrameStats(text) {
  assert(typeof text === 'string' && Buffer.byteLength(text) <= maxDumpBytes, 'Bounded package frame data required.');
  const packages = [...text.matchAll(/\*\* Graphics info for pid \d+ \[([^\]\r\n]+)\] \*\*/g)].map(match => match[1]);
  assert(packages.length === 1 && packages[0] === performancePackage, 'Only the reviewed QA package may be measured.');
  const total = /^Total frames rendered:\s*(\d+)\s*$/m.exec(text);
  const jank = /^Janky frames:\s*(\d+)\s*\(([\d.]+)%\)\s*$/m.exec(text);
  const renderer = {
    totalFramesRendered: total ? Number(total[1]) : null,
    jankyFrames: jank ? Number(jank[1]) : null,
    reportedJankPercent: jank ? Number(jank[2]) : null
  };
  assert(Object.values(renderer).every(value => value === null || Number.isFinite(value) && value >= 0));
  assert(renderer.reportedJankPercent === null || renderer.reportedJankPercent <= 100);
  assert(renderer.totalFramesRendered === null || renderer.jankyFrames === null || renderer.jankyFrames <= renderer.totalFramesRendered);
  const ignored = { flagged: 0, malformed: 0, missingOrSentinelTime: 0, nonpositiveDuration: 0 };
  let inside = false, header = null, profileBlocks = 0, rawRows = 0, deadlineSamples = 0, deadlineMisses = 0;
  const durations = [];
  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (line === '---PROFILEDATA---') {
      inside = !inside;
      if (inside) { profileBlocks++; header = null; }
      continue;
    }
    if (!inside || !line) continue;
    const fields = line.replace(/,$/, '').split(',');
    if (!header) {
      assert(fields.includes('Flags') && fields.includes('IntendedVsync') && fields.includes('FrameCompleted'), 'Required frame columns missing.');
      assert(new Set(fields).size === fields.length, 'Duplicate frame columns rejected.');
      header = fields; continue;
    }
    rawRows++;
    assert(rawRows <= 10_000, 'Frame row limit exceeded.');
    if (fields.length !== header.length || !fields.every(value => /^\d+$/.test(value))) { ignored.malformed++; continue; }
    const at = name => BigInt(fields[header.indexOf(name)]);
    if (at('Flags') !== 0n) { ignored.flagged++; continue; }
    const start = at('IntendedVsync'), end = at('FrameCompleted');
    if (start <= 0n || end <= 0n || start >= sentinel || end >= sentinel) { ignored.missingOrSentinelTime++; continue; }
    if (end <= start) { ignored.nonpositiveDuration++; continue; }
    durations.push(end - start);
    if (header.includes('FrameDeadline')) {
      const deadline = at('FrameDeadline');
      if (deadline > start && deadline < sentinel) { deadlineSamples++; if (end > deadline) deadlineMisses++; }
    }
  }
  assert(!inside, 'Incomplete profile block rejected.');
  durations.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const percentile = fraction => durations.length ? milliseconds(durations[Math.max(0, Math.ceil(fraction * durations.length) - 1)]) : null;
  return { renderer, profileBlocks, rawRows, validRows: durations.length, ignored,
    durationMs: { p50: percentile(.5), p90: percentile(.9), p95: percentile(.95), p99: percentile(.99),
      maximum: durations.length ? milliseconds(durations.at(-1)) : null },
    deadlineSamples, deadlineMisses: deadlineSamples ? deadlineMisses : null,
    sampleMayBeTruncated: true, durationDefinition: 'FrameCompleted - IntendedVsync', percentileMethod: 'nearest-rank' };
}

export function validateMeasurementGeometry(geometry) {
  assert(geometry && Number.isInteger(geometry.width) && Number.isInteger(geometry.height)
    && geometry.width > 0 && geometry.width <= 10_000 && geometry.height > 0 && geometry.height <= 10_000);
  assert(Number.isFinite(geometry.density) && geometry.density >= .5 && geometry.density <= 10);
  for (const key of ['card', 'undo']) {
    const rect = geometry[key];
    assert(Array.isArray(rect) && rect.length === 4 && rect.every(Number.isInteger));
    const [left, top, right, bottom] = rect;
    assert(left >= 0 && top >= 0 && right <= geometry.width && bottom <= geometry.height && right > left && bottom > top,
      'Cached controls must be fully inside the reviewed viewport.');
  }
  const [left, top, right, bottom] = geometry.undo;
  assert(right - left >= 40 * geometry.density && bottom - top >= 40 * geometry.density, 'Usable cached Undo target required.');
  const [cardLeft, , cardRight] = geometry.card;
  const distance = Math.min(Math.round(geometry.width * .36), Math.floor(cardRight - cardLeft - 16 * geometry.density));
  assert(distance >= 120 * geometry.density, 'Card must support a deliberate full swipe.');
  return true;
}

export async function measureMatchGestureWindow({ shell, geometry, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = () => performance.now(), utcNow = () => new Date().toISOString() }) {
  assert(typeof shell === 'function' && typeof sleep === 'function' && typeof now === 'function' && typeof utcNow === 'function');
  validateMeasurementGeometry(geometry);
  const center = rect => [Math.round((rect[0] + rect[2]) / 2), Math.round((rect[1] + rect[3]) / 2)];
  const [x, y] = center(geometry.card), [undoX, undoY] = center(geometry.undo);
  const distance = Math.min(Math.round(geometry.width * .36), Math.floor(geometry.card[2] - geometry.card[0] - 16 * geometry.density));
  const half = Math.floor(distance / 2);
  const commands = Array.from({ length: 6 }, (_, index) => [
    ['input', 'swipe', String(index % 2 === 0 ? x - half : x + half), String(y), String(index % 2 === 0 ? x + half : x - half), String(y), '350'],
    ['input', 'tap', String(undoX), String(undoY)]
  ]).flat();
  // The caller resolves visible native geometry and performs all hierarchy,
  // screenshot and settings work before this reset or after the final dump.
  await shell(['dumpsys', 'gfxinfo', performancePackage, 'reset']);
  const observedAt = utcNow(), started = now();
  for (const command of commands) {
    const remaining = 30_000 - (now() - started);
    assert(remaining > 0, 'Bounded measurement window exceeded.');
    // The fixed-target shell adapter must honor this timeout, including killing
    // its own ADB child on expiry; this module never owns an ADB service.
    await shell(command, Math.min(15_000, Math.floor(remaining)));
    await sleep(450);
  }
  const elapsedMs = now() - started;
  const dump = await shell(['dumpsys', 'gfxinfo', performancePackage, 'framestats']);
  const frames = parsePackageFrameStats(dump);
  assert(Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs <= 30_000, 'Bounded measurement window exceeded.');
  return { status: frames.validRows ? 'measured' : 'no-usable-frame-samples', scope: 'android-emulator-package-window',
    package: performancePackage, observedAt, actionCount: commands.length, actions: [...fixedActions],
    windowElapsedMs: Math.round(elapsedMs), settleMsAfterEachAction: 450, swipeDurationMs: 350,
    hierarchyOrScreenshotsDuringWindow: false, frames, limitations: [...limitations] };
}
