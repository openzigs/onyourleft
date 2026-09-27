// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  COLUMNS,
  gpuSummary,
  meminfoSummary,
  pageSummary,
  percentile,
  presentSummary,
  skinBefore,
  summarise,
  tableHeader,
  tableRow,
  thermalSummary,
} from './realistic-summary.mjs';

/**
 * Present times, one per line in SurfaceFlinger's three-column form, as the
 * sampler appends them: `desired  actual-present  frame-ready`, in ns.
 *
 * @param {readonly number[]} presentsMs
 */
function latency(presentsMs) {
  return presentsMs
    .map((ms) => {
      const ns = BigInt(Math.round(ms * 1e6)) + 529_645_000_000_000n;
      return `${String(ns - 5n)}\t${String(ns)}\t${String(ns - 3n)}`;
    })
    .join('\n');
}

/**
 * One thermal block, in the shape `realistic-sampler.sh` writes it — taken
 * from spike 0015's T20 run and cut down to the lines the summary reads.
 *
 * @param {{ epoch: number, cachedSkin: number, skin: number, appCpu: number, renderers: readonly number[] }} block
 */
function thermalBlock({ epoch, cachedSkin, skin, appCpu, renderers }) {
  return [
    `== ${String(epoch)}`,
    'Thermal Status: 0',
    `\tTemperature{mValue=${String(cachedSkin)}, mType=3, mName=VIRTUAL-SKIN, mStatus=0}`,
    'Current temperatures from HAL:',
    '\tTemperature{mValue=55.000004, mType=1, mName=G3D, mStatus=0}',
    `\tTemperature{mValue=${String(skin)}, mType=3, mName=VIRTUAL-SKIN, mStatus=0}`,
    '\tTemperatureThreshold{mType=3, mName=VIRTUAL-SKIN, mHotThrottlingThresholds=[NaN, 39.0, 43.0, 45.0, 47.0, 51.5, 56.0], mColdThrottlingThresholds=[NaN, NaN, NaN, NaN, NaN, NaN, NaN]}',
    ` 8011 u0_a384       0 -10  44G 588M 486M R ${String(appCpu)}   7.9   0:47.66 dev.openzigs.onyourleft`,
    '-- top',
    ` 8011 92.5 588M dev.openzigs.onyourleft`,
    ...renderers.map(
      (cpu, index) =>
        ` 80${String(index)}4 ${String(cpu)} 289M com.google.android.webview:sandboxed_process${String(index)}:org.chromium.content.app.SandboxedProcessService0:0`,
    ),
    '  526 29.6  65M surfaceflinger',
  ].join('\n');
}

describe('nearest-rank percentiles — #616', () => {
  it('is the smallest sample with at least p % at or below it, as the page’s own are', () => {
    const sorted = Array.from({ length: 20 }, (_, index) => index + 1);
    expect(percentile(sorted, 50)).toBe(10);
    expect(percentile(sorted, 95)).toBe(19);
    expect(percentile(sorted, 99)).toBe(20);
  });

  it('is nothing for no samples, never zero', () => {
    expect(percentile([], 50)).toBeUndefined();
  });
});

describe('present times — #616', () => {
  it('reads intervals between present times, once each however often the dumps overlap', () => {
    // Nineteen 16.67 ms frames and one 33.3 ms one; the dump is appended twice.
    const presents = [];
    let at = 0;
    for (let frame = 0; frame < 21; frame += 1) {
      presents.push(at);
      at += frame === 10 ? 33.34 : 16.67;
    }
    const text = `${latency(presents)}\n${latency(presents)}`;
    const summary = presentSummary(text);
    expect(summary.frames).toBe(21);
    expect(summary.p50).toBe(16.67);
    expect(summary.p95).toBe(16.67);
    expect(summary.p99).toBe(33.34);
    // One interval of twenty is over 20 ms.
    expect(summary.over20msShare).toBe(5);
  });

  it('leaves a hole in the sampling out, rather than counting it as one slow frame', () => {
    const summary = presentSummary(latency([0, 16.67, 33.34, 533.34, 550.01]));
    expect(summary.holes).toBe(1);
    expect(summary.over20msShare).toBe(0);
    expect(summary.p99).toBe(16.67);
  });

  it('skips a frame not yet presented, which SurfaceFlinger writes as 0 or INT64_MAX', () => {
    const text = [
      latency([0, 16.67]),
      '1\t0\t1',
      `1\t${String(2n ** 63n - 1n)}\t1`,
      '16666666', // the refresh period, the dump's first line
    ].join('\n');
    expect(presentSummary(text).frames).toBe(2);
  });
});

describe('the GPU clock — #616', () => {
  it('is the DVFS node’s kHz as MHz, and skips a line the node did not answer', () => {
    const text = [
      '1790463386 701000',
      '1790463387 633000',
      '1790463388 ',
      '1790463389 848000',
    ].join('\n');
    expect(gpuSummary(text)).toEqual({ samples: 3, mean: 727.3, p50: 701, p90: 848 });
  });
});

describe('the skin and the CPU — #616', () => {
  const blocks = [
    thermalBlock({ epoch: 1000, cachedSkin: 26, skin: 27.16, appCpu: 55.5, renderers: [58.6] }),
    thermalBlock({ epoch: 1600, cachedSkin: 29, skin: 30.0, appCpu: 89.6, renderers: [77.7, 2.3] }),
    thermalBlock({ epoch: 2200, cachedSkin: 31, skin: 32.84, appCpu: 90.1, renderers: [74.0] }),
    thermalBlock({ epoch: 2230, cachedSkin: 32, skin: 33.2, appCpu: 90.0, renderers: [74.0] }),
  ].join('\n');

  it('reads the HAL’s current skin, not the cached one listed before it', () => {
    const summary = thermalSummary(blocks);
    expect(summary.skinStart).toBe(27.2);
  });

  it('reads the skin at the block nearest minute 20, not the last one', () => {
    const summary = thermalSummary(blocks);
    expect(summary.skinLater).toBe(32.8);
    expect(summary.skinLaterMinute).toBe(20);
  });

  it('averages the app’s own %CPU and every WebView renderer’s, summed per block', () => {
    const summary = thermalSummary(blocks);
    expect(summary.appCpuMean).toBe(81.3);
    // (58.6 + 80.0 + 74.0 + 74.0) / 4
    expect(summary.rendererCpuMean).toBe(71.7);
    const cells = tableRow(summarise('run', { thermal: blocks })).split('|');
    expect(cells[COLUMNS.indexOf('CPU both %') + 1]?.trim()).toBe('153');
  });

  it('says at which minute a short run’s later skin was read', () => {
    const short = thermalSummary(
      [
        thermalBlock({ epoch: 0, cachedSkin: 26, skin: 26, appCpu: 50, renderers: [50] }),
        thermalBlock({ epoch: 300, cachedSkin: 28, skin: 28, appCpu: 50, renderers: [50] }),
      ].join('\n'),
    );
    expect(short.skinLaterMinute).toBe(5);
  });
});

describe('the skin before the app starts — #616', () => {
  it('is the HAL’s current VIRTUAL-SKIN, the last in the dump', () => {
    const text = [
      'Thermal Status: 0',
      '\tTemperature{mValue=27.463873, mType=3, mName=VIRTUAL-SKIN, mStatus=0}',
      'Current temperatures from HAL:',
      '\tTemperature{mValue=25.568312, mType=3, mName=VIRTUAL-SKIN, mStatus=0}',
    ].join('\n');
    expect(skinBefore(text)).toBe(25.6);
    expect(tableRow(summarise('run', { before: text }))).toContain('| 25.6 |');
  });
});

describe('memory at minute 10 — #616', () => {
  it('reads Graphics and GL mtrack from dumpsys meminfo, in MiB', () => {
    const text = [
      '== 1790464000',
      '   EGL mtrack   113764   113764        0        0   113764',
      '    GL mtrack   315612   315612        0        0   315612',
      '            Graphics:   429376                         429376',
      '           TOTAL PSS:   551170            TOTAL RSS:   713676',
    ].join('\n');
    expect(meminfoSummary(text)).toEqual({ graphics: 419.3, glMtrack: 308.2, totalPss: 538.3 });
  });

  it('reads EGL mtrack as nothing, rather than as GL mtrack', () => {
    expect(meminfoSummary('   EGL mtrack   113764\n').glMtrack).toBeUndefined();
  });
});

describe('the page’s own minutes — #616', () => {
  it('takes the median triangles and draw calls over the soak, with logcat’s prefix on each line', () => {
    const minute = (/** @type {number} */ triangles, /** @type {number} */ calls) =>
      `1790463386.123  8011  8011 I Capacitor/Console: OYL-REALISTIC-SOAK ${JSON.stringify({
        world: 'realistic',
        rung: 'realistic',
        trianglesPerFrame: triangles,
        drawCalls: calls,
        layersOff: ['impostors'],
        minute: 1,
      })}`;
    const text = [
      minute(270_000, 35),
      'OYL-REALISTIC {"not":"a soak minute"}',
      minute(272_000, 36),
      minute(280_000, 38),
      'OYL-REALISTIC-SOAK {"cut short',
    ].join('\n');
    const page = pageSummary(text);
    expect(page.minutes).toBe(3);
    expect(page.trianglesPerFrame).toBe(272_000);
    expect(page.drawCalls).toBe(36);
    expect(page.layersOff).toEqual(['impostors']);
    expect(page.worlds).toEqual(['realistic']);
  });
});

describe('one row of the table — #616', () => {
  it('has a cell for every column, and a dash for a figure that could not be read', () => {
    const row = tableRow(summarise('T20', { gpu: '1 701000\n2 848000' }));
    const cells = row.split('|').slice(1, -1);
    expect(cells).toHaveLength(COLUMNS.length);
    expect(cells[0]?.trim()).toBe('T20');
    expect(cells[COLUMNS.indexOf('GPU mean MHz')]?.trim()).toBe('774.5');
    expect(cells[COLUMNS.indexOf('present p50 ms')]?.trim()).toBe('—');
    expect(cells[COLUMNS.indexOf('layers off')]?.trim()).toBe('—');
    expect(cells[COLUMNS.indexOf('CPU both %')]?.trim()).toBe('—');
    expect(tableHeader().split('\n')[0]?.split('|').slice(1, -1)).toHaveLength(COLUMNS.length);
  });

  it('marks a later skin that was not read at minute 20 with the minute it was', () => {
    const thermal = [
      thermalBlock({ epoch: 0, cachedSkin: 26, skin: 26, appCpu: 50, renderers: [50] }),
      thermalBlock({ epoch: 300, cachedSkin: 28, skin: 28, appCpu: 50, renderers: [50] }),
    ].join('\n');
    const row = tableRow(summarise('short', { thermal }));
    expect(row).toContain('| 28 (min 5) |');
  });
});
