import { describe, expect, it } from 'vitest';
import { measureMatchGestureWindow, parsePackageFrameStats, validateMeasurementGeometry } from '../tests/e2e/player-android-qa/mapPerformance.mjs';

const base = 9007199254740993000n;
const header = 'Flags,FrameCompleted,IntendedVsync,FrameDeadline';
const row = (durationMs, flags = 0, offset = 0n) => `${flags},${base + offset + BigInt(durationMs) * 1000000n},${base + offset},${base + offset + 16000000n}`;
const dump = (rows, columns = header) => `** Graphics info for pid 1234 [com.orbit.player.qa] **\nTotal frames rendered: 4\nJanky frames: 2 (50.00%)\n---PROFILEDATA---\n${columns},\n${rows.join(',\n')},\n---PROFILEDATA---\n`;
const geometry = { width: 1080, height: 2400, density: 2.625, card: [42, 300, 1038, 1500], undo: [840, 140, 980, 260] };

describe('bounded package-only Android Map measurement', () => {
  it('reads dynamic columns and nanosecond timestamps beyond Number precision', () => {
    const parsed = parsePackageFrameStats(dump([row(10), row(20, 0, 1n), row(30, 0, 2n), row(40, 0, 3n)]));
    expect(parsed.durationMs).toEqual({ p50: 20, p90: 40, p95: 40, p99: 40, maximum: 40 });
    expect(parsed).toMatchObject({ rawRows: 4, validRows: 4, profileBlocks: 1, deadlineSamples: 4, deadlineMisses: 3, sampleMayBeTruncated: true });
    expect(parsed.renderer).toEqual({ totalFramesRendered: 4, jankyFrames: 2, reportedJankPercent: 50 });
  });

  it('keeps renderer totals distinct and explains excluded rows without hiding a slow frame', () => {
    const parsed = parsePackageFrameStats(dump([row(6000), row(2, 1), '0,0,0,0', `0,${base},${base},${base + 1n}`, '0,broken', '0,9223372036854775807,1,2']));
    expect(parsed.validRows).toBe(1); expect(parsed.durationMs.maximum).toBe(6000);
    expect(parsed.ignored).toEqual({ flagged: 1, malformed: 1, missingOrSentinelTime: 2, nonpositiveDuration: 1 });
    expect(parsed.renderer.totalFramesRendered).toBe(4);
  });

  it('does not invent a deadline or fixed refresh interval when that column is absent', () => {
    const parsed = parsePackageFrameStats(dump([`0,${base},${base + 17000000n}`], 'Flags,IntendedVsync,FrameCompleted'));
    expect(parsed).toMatchObject({ deadlineSamples: 0, deadlineMisses: null, validRows: 1 });
    expect(parsed.durationMs.p50).toBe(17);
  });

  it('rejects foreign packages, oversized output, duplicate columns and incomplete blocks', () => {
    const valid = dump([row(10)]);
    expect(() => parsePackageFrameStats(valid.replace('com.orbit.player.qa', 'com.other.app'))).toThrow();
    expect(() => parsePackageFrameStats('x'.repeat(2 * 1024 * 1024 + 1))).toThrow();
    expect(() => parsePackageFrameStats(valid.replace(header, header + ',Flags'))).toThrow();
    expect(() => parsePackageFrameStats(valid.slice(0, valid.lastIndexOf('---PROFILEDATA---')))).toThrow();
  });

  it('rejects clipped controls and swipes too short to commit', () => {
    expect(validateMeasurementGeometry(geometry)).toBe(true);
    expect(() => validateMeasurementGeometry({ ...geometry, undo: [840, -1, 980, 260] })).toThrow();
    expect(() => validateMeasurementGeometry({ ...geometry, undo: [840, 140, 850, 150] })).toThrow();
    expect(() => validateMeasurementGeometry({ ...geometry, card: [300, 300, 400, 1500] })).toThrow();
  });

  it('runs exactly one twelve-action window between reset and dump, with no hierarchy/capture API', async () => {
    const calls = []; let clock = 0;
    const result = await measureMatchGestureWindow({ geometry,
      shell: async (args, timeout) => { calls.push({ args, timeout }); clock += 2; return args.at(-1) === 'framestats' ? dump([row(10)]) : ''; },
      sleep: async ms => { clock += ms; }, now: () => clock, utcNow: () => '2026-10-13T23:00:00.000Z'
    });
    expect(calls.map(call => call.args.slice(0, 3))).toEqual([
      ['dumpsys', 'gfxinfo', 'com.orbit.player.qa'],
      ...Array.from({ length: 6 }, (_, index) => [['input', 'swipe', index % 2 === 0 ? '346' : '734'], ['input', 'tap', '910']]).flat(),
      ['dumpsys', 'gfxinfo', 'com.orbit.player.qa']
    ]);
    expect(calls[0].args.at(-1)).toBe('reset'); expect(calls.at(-1).args.at(-1)).toBe('framestats');
    expect(calls.slice(1, 13).every(call => call.timeout > 0 && call.timeout <= 15000)).toBe(true);
    expect(result).toMatchObject({ status: 'measured', actionCount: 12, windowElapsedMs: 5424, hierarchyOrScreenshotsDuringWindow: false });
    expect(result).not.toHaveProperty('fps');
  });

  it('reports an empty frame sample without a performance pass', async () => {
    const result = await measureMatchGestureWindow({ geometry, shell: async args => args.at(-1) === 'framestats' ? dump([]) : '', sleep: async () => {}, now: () => 0 });
    expect(result.status).toBe('no-usable-frame-samples'); expect(result.frames.durationMs.p95).toBeNull();
  });

  it('rejects invalid geometry before any command and stops scheduling actions after its budget', async () => {
    let calls = 0, clock = 0;
    const shell = async () => { calls++; return ''; };
    await expect(measureMatchGestureWindow({ shell, geometry: { ...geometry, width: 0 } })).rejects.toThrow();
    expect(calls).toBe(0);
    await expect(measureMatchGestureWindow({ shell, geometry, sleep: async () => { clock += 16000; }, now: () => clock })).rejects.toThrow('Bounded measurement');
    expect(calls).toBe(3); // Reset and two actions; no later action or dump is scheduled.
  });
});
