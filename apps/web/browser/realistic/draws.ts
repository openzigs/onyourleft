// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the owner's realistic page counts at the WebGL draw calls — the calls
 * themselves since #478, and since #616 the triangles they submit.
 *
 * ## Why the draw calls, and not three's own `renderer.info`
 *
 * `renderer.info.render` is the renderer's account of what it drew, and it is
 * reset at the start of every `render` — so it says nothing about a draw three
 * makes outside one (a prefiltered sky, a compile's warm-up) and nothing a
 * second engine could be held to. What reaches `drawArrays` and `drawElements`
 * is what the GPU was asked to do, whoever asked, and it is the one count an
 * engine-neutral comparison (#615, spike 0015) can use. The browser gate
 * (`realistic.browser.spec.ts`) holds the two to within 1 % of each other on a
 * frame where they must agree, so neither can drift from the other silently.
 *
 * ## The arithmetic
 *
 * Triangles are counted as three counts them (`WebGLInfo.update`): a
 * `TRIANGLES` draw submits `count / 3` triangles per instance, and every other
 * mode — lines, points, strips — submits none. three draws its meshes as
 * `TRIANGLES`; a strip or a fan would be a triangle count this file does not
 * make, which is why a mode it does not count is still a draw call.
 *
 * ⚠️ **What it does not wrap**: `drawRangeElements`, which three does not
 * call, and `WEBGL_multi_draw`'s entry points, which three calls only for a
 * `BatchedMesh` and this renderer has none of. A renderer that started using
 * either would draw triangles this counter never sees — and the browser gate's
 * 1 % agreement with `renderer.info` is what would say so.
 *
 * ## What it costs
 *
 * One comparison and, for a triangle draw, a multiply and an add, on every
 * draw call the page makes — on top of the increment #478's counter already
 * paid there. Nothing is allocated.
 */

/** `WebGLRenderingContext.TRIANGLES`. A constant, so no context is needed to read it. */
export const GL_TRIANGLES = 4;

/** The four draw entry points three calls, and that this counts. */
export const COUNTED_DRAWS = [
  'drawElements',
  'drawArrays',
  'drawElementsInstanced',
  'drawArraysInstanced',
] as const;

/** One of {@link COUNTED_DRAWS}. */
export type CountedDraw = (typeof COUNTED_DRAWS)[number];

/**
 * The triangles one draw call submits, from its own arguments:
 *
 * | call | arguments | count | instances |
 * |---|---|---|---|
 * | `drawArrays` | `mode, first, count` | 3rd | 1 |
 * | `drawElements` | `mode, count, type, offset` | 2nd | 1 |
 * | `drawArraysInstanced` | `mode, first, count, instances` | 3rd | 4th |
 * | `drawElementsInstanced` | `mode, count, type, offset, instances` | 2nd | 5th |
 *
 * Zero for any mode but `TRIANGLES`, as three counts it.
 */
export function trianglesInDraw(name: CountedDraw, args: ArrayLike<unknown>): number {
  if (args[0] !== GL_TRIANGLES) return 0;
  const elements = name === 'drawElements' || name === 'drawElementsInstanced';
  const count = Number(args[elements ? 1 : 2] ?? 0);
  const instances =
    name === 'drawElementsInstanced'
      ? Number(args[4] ?? 0)
      : name === 'drawArraysInstanced'
        ? Number(args[3] ?? 0)
        : 1;
  return (count / 3) * instances;
}

/** What {@link drawCounter} hands back: each take returns what was counted since the last. */
export interface DrawCounter {
  /** Draw calls since the last take, of every mode. */
  takeCalls(): number;
  /** Triangles submitted since the last take. @see trianglesInDraw */
  takeTriangles(): number;
}

/**
 * Counts every draw call made through `prototype` for the life of the page,
 * and the triangles each submits. `prototype` is `WebGL2RenderingContext`'s on
 * the page; a parameter so a test can hand it an object of its own, because
 * jsdom has no WebGL at all.
 */
export function drawCounter(prototype: object): DrawCounter {
  const methods = prototype as Record<string, unknown>;
  let calls = 0;
  let triangles = 0;
  for (const name of COUNTED_DRAWS) {
    const original = methods[name] as (...args: unknown[]) => unknown;
    methods[name] = function counted(this: unknown, ...args: unknown[]): unknown {
      calls += 1;
      triangles += trianglesInDraw(name, args);
      return original.apply(this, args);
    };
  }
  return {
    takeCalls: () => {
      const taken = calls;
      calls = 0;
      return taken;
    },
    takeTriangles: () => {
      const taken = triangles;
      triangles = 0;
      return taken;
    },
  };
}
