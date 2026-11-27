// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616's spike: the command-line options `live.ts` and `harness/main.ts`
 * read, each a flag and the value after it.
 *
 * A flag given with no value is refused, never read as absent (#2715): read
 * as absent, `--run` with its value forgotten wrote to `results/` itself and
 * overwrote spike 0039's committed first-run logs, and `--results` wrote to
 * the committed `results/scores/`. A value that starts with `-` is the next
 * flag, so it is missing too.
 *
 * Spike code: see `decision.ts`.
 */

/** `args` with the option `name` and its value taken out, and the value. */
export function option(
  args: readonly string[],
  name: string,
): [readonly string[], string | undefined] {
  const at = args.indexOf(name);
  if (at < 0) return [args, undefined];
  return [[...args.slice(0, at), ...args.slice(at + 2)], args[at + 1]];
}

/**
 * The first of `names` that `args` gives with no value after it, or with the
 * next flag there instead, or `undefined` when each is given its value or not
 * at all.
 */
export function missingValue(
  args: readonly string[],
  names: readonly string[],
): string | undefined {
  return names.find((name) => {
    const at = args.indexOf(name);
    if (at < 0) return false;
    const value = args[at + 1];
    return value === undefined || value.startsWith('-');
  });
}
