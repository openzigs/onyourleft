// SPDX-License-Identifier: AGPL-3.0-or-later
//
// lint-memory.mjs — how close one ESLint process came to its heap limit. #2272.
//
// `pnpm run lint` loads this into ESLint with `--import`. On exit it prints one
// line to stderr: the most heap the process was seen using, the V8 heap limit it
// ran under, and its peak resident set from the operating system.
//
// The heap figure is the largest `used_heap_size` seen by a sample every 100 ms
// and at exit, so it counts garbage not yet collected: it is an upper bound on
// what the process needed, and the number to hold beside the limit. A process
// whose live heap reaches the limit never prints this line at all; it dies with
// "JavaScript heap out of memory", which is how #2272 was found.

import { setInterval } from 'node:timers';
import { getHeapStatistics } from 'node:v8';

let peak = 0;

function sample() {
  const { used_heap_size: used } = getHeapStatistics();
  if (used > peak) peak = used;
}

setInterval(sample, 100).unref();

process.on('exit', () => {
  sample();
  const megabytes = (bytes) => Math.round(bytes / 2 ** 20);
  const limit = megabytes(getHeapStatistics().heap_size_limit);
  // maxRSS is in kilobytes.
  const rss = Math.round(process.resourceUsage().maxRSS / 1024);
  process.stderr.write(
    `lint-memory: peak heap ${megabytes(peak)} MB of a ${limit} MB limit, peak RSS ${rss} MB\n`,
  );
});
