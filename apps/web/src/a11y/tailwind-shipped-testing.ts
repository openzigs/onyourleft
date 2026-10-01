// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The utilities CSS the product ships — #950. Test support, never shipped.
 *
 * Tailwind's own scanner over the `@source` globs `design/tailwind.css`
 * declares, and Tailwind's own compiler over that file: the same two steps
 * `@tailwindcss/vite` takes in a build, so what this returns is what a build
 * writes into the stylesheet, not a list somebody keeps.
 *
 * Two gates read it: `tailwind.a11y.test.ts`, which holds every value in it to
 * a token, and `theme.a11y.test.ts`, which counts a token a utility paints
 * with as painted — since #950 a status tone's colours are read by a utility
 * rather than by a rule in `theme.css`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

export const DESIGN_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', 'design');
export const TAILWIND_CSS_PATH = join(DESIGN_DIRECTORY, 'tailwind.css');

export type TailwindCompiler = Awaited<ReturnType<typeof compile>>;

/** Tailwind's compiler over a stylesheet — `tailwind.css`, or a fixture made from it. */
export function tailwindCompiler(css: string): Promise<TailwindCompiler> {
  return compile(css, {
    base: DESIGN_DIRECTORY,
    from: TAILWIND_CSS_PATH,
    onDependency: () => undefined,
  });
}

/** The candidates Tailwind finds in the sources, and the CSS it builds from them. */
export async function shippedUtilities(): Promise<{
  readonly compiler: TailwindCompiler;
  readonly candidates: string[];
  readonly css: string;
}> {
  const compiler = await tailwindCompiler(readFileSync(TAILWIND_CSS_PATH, 'utf8'));
  const candidates = new Scanner({ sources: compiler.sources }).scan();
  return { compiler, candidates, css: compiler.build(candidates) };
}
