// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Turns what `realistic-sampler.sh` wrote into one row of validation 0002's
 * realistic-world table (#616) — spike 0015's `analyse.py`, reduced to the
 * columns #615 budgets, in the language the rest of this repository's tooling
 * is in.
 *
 * ## Use
 *
 * ```bash
 * node apps/mobile/tools/realistic-summary.mjs RUN_DIR [RUN_DIR…]         # the table
 * node apps/mobile/tools/realistic-summary.mjs --json RUN_DIR [RUN_DIR…]  # every figure
 * ```
 *
 * A run directory is what the sampler wrote, pulled off the device, plus two
 * files the host writes: `before.txt`, a `dumpsys thermalservice` taken before
 * the app is started, and `oyl.txt`, the page's `OYL-REALISTIC` lines from
 * `adb logcat`. Validation
 * 0002's Part for #616 has the commands.
 *
 * ⚠️ **It asks nothing of its own**, as `webview-probe.mjs` does not: which
 * run, which layers were off and what counts as a difference are the Part's.
 * It reads, and says what it could not read rather than printing a zero.
 *
 * ## What each column is
 *
 * | column | from | how |
 * |---|---|---|
 * | present p50 / p90 / p95 / p99 | `latency.txt` | SurfaceFlinger's present times, de-duplicated across the overlapping dumps, as intervals in ms; an interval of 250 ms or more is a hole in the sampling, not a frame, and is left out (spike 0015's rule) |
 * | over 20 ms | the same intervals | the share, in %, longer than 20 ms |
 * | GPU mean / p50 / p90 | `gpu.txt` | the Mali DVFS clock, in MHz |
 * | skin before | `before.txt` | `VIRTUAL-SKIN`, °C, read on the host before the app is started — the cooled tablet |
 * | skin start / min 20 | `thermal.txt` | `VIRTUAL-SKIN`, °C: the sampler's first block, and the block nearest 20 minutes after it |
 * | CPU app / WebView / both | `thermal.txt` | mean `%CPU` over the blocks, of one core: the app's own `top` line, the `sandboxed_process` lines summed, and the two added — #615's "CPU" |
 * | Graphics / GL mtrack | `meminfo.txt` | MiB, as `dumpsys meminfo` reports them at the sampler's minute 10 |
 * | triangles / draw calls | `oyl.txt` | per frame, the median over the page's `OYL-REALISTIC-SOAK` minutes |
 *
 * Percentiles are nearest-rank, as the page's own are (`realistic/config.ts`
 * §`percentiles`) and as spike 0015's were — so a figure here and a figure
 * there are the same statistic.
 *
 * ⚠️ **The WebView renderer's CPU is every `sandboxed_process` in the busiest
 * twelve**, spike 0015's rule. Any other app's WebView renderer running at the
 * same time is counted with ours — spike 0015's own T20 run had the product
 * app (`dev.openzigs.onyourleft`) running beside the spike's package — which is
 * why the Part stops every other app before a run rather than this file
 * guessing which renderer is whose.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** An interval this long or longer is a hole in the sampling or a pause, not a frame. */
export const HOLE_MS = 250;

/** The frame interval a share is counted over: longer than this is a missed vsync at 60 Hz. */
export const SLOW_FRAME_MS = 20;

/** When the "minute 20" skin reading is taken, in seconds after the first block. */
export const SKIN_AT_SECONDS = 20 * 60;

/**
 * The nearest-rank percentile: the smallest sample with at least p % of the
 * samples at or below it. `undefined` for no samples — never zero.
 *
 * @param {readonly number[]} sorted ascending
 * @param {number} p
 * @returns {number | undefined}
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return undefined;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** @param {readonly number[]} values */
function mean(values) {
  return values.length === 0
    ? undefined
    : values.reduce((sum, each) => sum + each, 0) / values.length;
}

/** @param {number | undefined} value @param {number} places */
function rounded(value, places) {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

/**
 * Frame intervals from `dumpsys SurfaceFlinger --latency` output, in ms.
 *
 * @param {string} text
 */
export function presentIntervals(text) {
  const presents = new Set();
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 3) continue;
    const actual = BigInt(parts[1] ?? '0');
    // SurfaceFlinger writes 0 or INT64_MAX for a frame not yet presented.
    if (actual <= 0n || actual >= 2n ** 62n) continue;
    presents.add(actual);
  }
  const sorted = [...presents].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  /** @type {number[]} */
  const intervals = [];
  let holes = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap =
      Number(/** @type {bigint} */ (sorted[index]) - /** @type {bigint} */ (sorted[index - 1])) /
      1e6;
    if (gap >= HOLE_MS) holes += 1;
    else intervals.push(gap);
  }
  return { frames: sorted.length, intervals, holes };
}

/**
 * The present-time figures.
 *
 * @param {string} text `latency.txt`
 */
export function presentSummary(text) {
  const { frames, intervals, holes } = presentIntervals(text);
  const sorted = [...intervals].sort((a, b) => a - b);
  const slow = intervals.filter((gap) => gap > SLOW_FRAME_MS).length;
  return {
    frames,
    holes,
    p50: rounded(percentile(sorted, 50), 2),
    p90: rounded(percentile(sorted, 90), 2),
    p95: rounded(percentile(sorted, 95), 2),
    p99: rounded(percentile(sorted, 99), 2),
    over20msShare: intervals.length === 0 ? undefined : rounded((slow / intervals.length) * 100, 2),
  };
}

/**
 * The GPU clock, in MHz, from `EPOCH KHZ` lines.
 *
 * @param {string} text `gpu.txt`
 */
export function gpuSummary(text) {
  const kilohertz = [];
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 2) continue;
    const value = Number(parts[1]);
    if (Number.isFinite(value) && parts[1] !== '') kilohertz.push(value);
  }
  const sorted = [...kilohertz].sort((a, b) => a - b);
  const mhz = (/** @type {number | undefined} */ value) =>
    value === undefined ? undefined : rounded(value / 1000, 1);
  return {
    samples: kilohertz.length,
    mean: mhz(mean(kilohertz)),
    p50: mhz(percentile(sorted, 50)),
    p90: mhz(percentile(sorted, 90)),
  };
}

/**
 * One 30-second block of `thermal.txt`.
 *
 * @typedef {{ epoch: number, skin: number | undefined, appCpu: number | undefined, rendererCpu: number | undefined }} ThermalBlock
 */

/**
 * The thermal blocks. The skin is the LAST `VIRTUAL-SKIN` in a block, because
 * `dumpsys thermalservice` lists its cached temperatures first and the HAL's
 * current ones after.
 *
 * @param {string} text
 * @returns {ThermalBlock[]}
 */
export function thermalBlocks(text) {
  return text
    .split(/^== /m)
    .slice(1)
    .map((block) => {
      const [head = '', top] = block.split('-- top');
      const lines = head.trim().split('\n');
      const skins = [...head.matchAll(/mValue=([0-9.]+), mType=[-0-9]+, mName=VIRTUAL-SKIN,/g)];
      const lastSkin = skins.at(-1)?.[1];
      // The app's own `top -p PID` line, last before `-- top`: %CPU is its ninth field.
      const own = (lines.at(-1) ?? '').trim().split(/\s+/);
      const appCpu =
        own.length > 9 && !own[0]?.startsWith('Temperature') ? Number(own[8]) : undefined;
      let rendererCpu;
      if (top !== undefined) {
        rendererCpu = 0;
        for (const line of top.trim().split('\n')) {
          const fields = line.trim().split(/\s+/);
          if (fields.length >= 4 && line.includes('sandboxed_process')) {
            rendererCpu += Number(fields[1]);
          }
        }
      }
      return {
        epoch: Number(lines[0]),
        skin: lastSkin === undefined ? undefined : Number(lastSkin),
        appCpu: appCpu !== undefined && Number.isFinite(appCpu) ? appCpu : undefined,
        rendererCpu,
      };
    });
}

/**
 * The thermal and CPU figures.
 *
 * @param {string} text `thermal.txt`
 */
export function thermalSummary(text) {
  const blocks = thermalBlocks(text);
  const first = blocks[0];
  // The block nearest SKIN_AT_SECONDS after the first — the last one, in a
  // shorter run, and the summary says at which minute it was.
  let later;
  for (const block of blocks) {
    if (first === undefined) break;
    const distance = Math.abs(block.epoch - first.epoch - SKIN_AT_SECONDS);
    if (later === undefined || distance < Math.abs(later.epoch - first.epoch - SKIN_AT_SECONDS)) {
      later = block;
    }
  }
  const defined = (/** @type {(number | undefined)[]} */ values) =>
    values.filter((/** @type {number | undefined} */ value) => value !== undefined);
  return {
    blocks: blocks.length,
    skinStart: rounded(first?.skin, 1),
    skinLater: rounded(later?.skin, 1),
    skinLaterMinute:
      first === undefined || later === undefined
        ? undefined
        : rounded((later.epoch - first.epoch) / 60, 1),
    appCpuMean: rounded(mean(defined(blocks.map((block) => block.appCpu))), 1),
    rendererCpuMean: rounded(mean(defined(blocks.map((block) => block.rendererCpu))), 1),
  };
}

/**
 * The skin before the run, from a `dumpsys thermalservice` taken on the host
 * before the app was started: the last `VIRTUAL-SKIN`, which is the HAL's
 * current reading rather than the cached one listed first.
 *
 * @param {string} text `before.txt`
 */
export function skinBefore(text) {
  const skins = [...text.matchAll(/mValue=([0-9.]+), mType=[-0-9]+, mName=VIRTUAL-SKIN,/g)];
  const last = skins.at(-1)?.[1];
  return last === undefined ? undefined : rounded(Number(last), 1);
}

/**
 * `Graphics` and `GL mtrack`, in MiB, from `dumpsys meminfo PID`.
 *
 * @param {string} text `meminfo.txt`
 */
export function meminfoSummary(text) {
  const kilobytes = (/** @type {RegExp} */ pattern) => {
    const found = pattern.exec(text);
    return found === null ? undefined : rounded(Number(found[1]) / 1024, 1);
  };
  return {
    graphics: kilobytes(/^\s*Graphics:\s+(\d+)/m),
    glMtrack: kilobytes(/^\s*GL mtrack\s+(\d+)/m),
    totalPss: kilobytes(/TOTAL PSS:\s+(\d+)/),
  };
}

/**
 * The page's own minutes, from `OYL-REALISTIC-SOAK {json}` lines anywhere in
 * `oyl.txt` — logcat's prefix before the tag is ignored.
 *
 * @param {string} text
 */
export function pageSummary(text) {
  /** @type {{ trianglesPerFrame?: number, drawCalls?: number, rung?: string, world?: string, layersOff?: string[] }[]} */
  const minutes = [];
  for (const line of text.split('\n')) {
    const at = line.indexOf('OYL-REALISTIC-SOAK {');
    if (at < 0) continue;
    try {
      minutes.push(JSON.parse(line.slice(at + 'OYL-REALISTIC-SOAK '.length)));
    } catch {
      // A line logcat cut short; the rest still count.
    }
  }
  const median = (/** @type {(number | undefined)[]} */ values) =>
    percentile(
      values
        .filter((value) => typeof value === 'number')
        .sort((a, b) => /** @type {number} */ (a) - /** @type {number} */ (b)),
      50,
    );
  return {
    minutes: minutes.length,
    trianglesPerFrame: median(minutes.map((minute) => minute.trianglesPerFrame)),
    drawCalls: median(minutes.map((minute) => minute.drawCalls)),
    worlds: [...new Set(minutes.map((minute) => minute.world))],
    rungs: [...new Set(minutes.map((minute) => minute.rung))],
    layersOff: minutes[0]?.layersOff ?? [],
  };
}

/**
 * Every figure for one run, from its files' text. A file that is absent is
 * `undefined`, and so is every figure read from it.
 *
 * @param {string} run
 * @param {{ before?: string, latency?: string, gpu?: string, thermal?: string, meminfo?: string, oyl?: string }} files
 */
export function summarise(run, files) {
  return {
    run,
    skinBefore: files.before === undefined ? undefined : skinBefore(files.before),
    present: files.latency === undefined ? undefined : presentSummary(files.latency),
    gpuMHz: files.gpu === undefined ? undefined : gpuSummary(files.gpu),
    thermal: files.thermal === undefined ? undefined : thermalSummary(files.thermal),
    memoryMiB: files.meminfo === undefined ? undefined : meminfoSummary(files.meminfo),
    page: files.oyl === undefined ? undefined : pageSummary(files.oyl),
  };
}

/** The table's columns, in order. */
export const COLUMNS = [
  'run',
  'present p50 ms',
  'p90',
  'p95',
  'p99',
  '> 20 ms %',
  'GPU mean MHz',
  'GPU p50',
  'GPU p90',
  'skin before °C',
  'skin start °C',
  'skin min 20 °C',
  'CPU app %',
  'CPU WebView %',
  'CPU both %',
  'Graphics MiB',
  'GL mtrack MiB',
  'triangles / frame',
  'draw calls',
  'layers off',
];

/**
 * One markdown row. A figure that could not be read is `—`, and a skin
 * reading not taken at minute 20 says the minute it was.
 *
 * @param {ReturnType<typeof summarise>} summary
 */
export function tableRow(summary) {
  const cell = (/** @type {unknown} */ value) => (value === undefined ? '—' : String(value));
  const { present, gpuMHz, thermal, memoryMiB, page } = summary;
  const later =
    thermal?.skinLater === undefined
      ? undefined
      : thermal.skinLaterMinute !== undefined && Math.abs(thermal.skinLaterMinute - 20) > 0.5
        ? `${String(thermal.skinLater)} (min ${String(thermal.skinLaterMinute)})`
        : thermal.skinLater;
  const values = [
    summary.run,
    present?.p50,
    present?.p90,
    present?.p95,
    present?.p99,
    present?.over20msShare,
    gpuMHz?.mean,
    gpuMHz?.p50,
    gpuMHz?.p90,
    summary.skinBefore,
    thermal?.skinStart,
    later,
    thermal?.appCpuMean,
    thermal?.rendererCpuMean,
    thermal?.appCpuMean === undefined || thermal.rendererCpuMean === undefined
      ? undefined
      : rounded(thermal.appCpuMean + thermal.rendererCpuMean, 1),
    memoryMiB?.graphics,
    memoryMiB?.glMtrack,
    page?.trianglesPerFrame,
    page?.drawCalls,
    page === undefined || page.minutes === 0
      ? undefined
      : page.layersOff.length === 0
        ? 'none'
        : page.layersOff.join(', '),
  ];
  return `| ${values.map(cell).join(' | ')} |`;
}

/** The table's header and its rule. */
export function tableHeader() {
  return `| ${COLUMNS.join(' | ')} |\n|${COLUMNS.map(() => '---').join('|')}|`;
}

/** @param {string} directory */
function readRun(directory) {
  const present = new Set(readdirSync(directory));
  const read = (/** @type {string} */ name) =>
    present.has(name) ? readFileSync(join(directory, name), 'utf8') : undefined;
  return {
    before: read('before.txt'),
    latency: read('latency.txt'),
    gpu: read('gpu.txt'),
    thermal: read('thermal.txt'),
    meminfo: read('meminfo.txt'),
    oyl: read('oyl.txt'),
  };
}

function main() {
  const args = process.argv.slice(2);
  const json = args[0] === '--json';
  const directories = json ? args.slice(1) : args;
  if (directories.length === 0) {
    console.error(
      'usage: node apps/mobile/tools/realistic-summary.mjs [--json] RUN_DIR [RUN_DIR…]',
    );
    process.exit(2);
  }
  const summaries = directories.map((directory) =>
    summarise(directory.replace(/\/+$/, '').split('/').at(-1) ?? directory, readRun(directory)),
  );
  if (json) {
    console.log(JSON.stringify(summaries, null, 1));
    return;
  }
  console.log(tableHeader());
  for (const summary of summaries) console.log(tableRow(summary));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
