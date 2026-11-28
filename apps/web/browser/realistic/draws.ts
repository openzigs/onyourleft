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
 * ⚠️ **Since #3287 it wraps `WEBGL_multi_draw`'s two entry points too**, which
 * three calls for a `BatchedMesh` and the stylised scenery now is one where a
 * mesh holds several shapes: a multi-draw is ONE call, and submits the sum of
 * its draws' counts ({@link watchMultiDraws}). They are methods of the
 * extension object and not of the context, so they are patched on that
 * object's prototype ({@link multiDrawPrototype}).
 *
 * ⚠️ **What it does not wrap**: `drawRangeElements` and the instanced
 * multi-draws, which three does not call. A renderer that started using
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

/** `WEBGL_multi_draw`'s entry points three calls, for a `BatchedMesh`. */
export const COUNTED_MULTI_DRAWS = ['multiDrawElementsWEBGL', 'multiDrawArraysWEBGL'] as const;

export type CountedMultiDraw = (typeof COUNTED_MULTI_DRAWS)[number];

/**
 * The indices (or vertices) one multi-draw submits: the sum of its draws'
 * counts — #3287.
 *
 * | call | arguments | counts | draws |
 * |---|---|---|---|
 * | `multiDrawElementsWEBGL` | `mode, counts, countsOffset, type, offsets, offsetsOffset, draws` | 2nd, from the 3rd | 7th |
 * | `multiDrawArraysWEBGL` | `mode, firsts, firstsOffset, counts, countsOffset, draws` | 4th, from the 5th | 6th |
 */
export function indicesInMultiDraw(name: CountedMultiDraw, args: ArrayLike<unknown>): number {
  const elements = name === 'multiDrawElementsWEBGL';
  const counts = args[elements ? 1 : 3] as ArrayLike<number> | undefined;
  const from = Number(args[elements ? 2 : 4] ?? 0);
  const draws = Number(args[elements ? 6 : 5] ?? 0);
  let submitted = 0;
  for (let draw = 0; draw < draws; draw += 1) submitted += Number(counts?.[from + draw] ?? 0);
  return submitted;
}

/** The triangles one multi-draw submits, as {@link trianglesInDraw} counts a draw's. */
export function trianglesInMultiDraw(name: CountedMultiDraw, args: ArrayLike<unknown>): number {
  return args[0] === GL_TRIANGLES ? indicesInMultiDraw(name, args) / 3 : 0;
}

let multiDrawFound: object | null | undefined;

/**
 * The prototype `WEBGL_multi_draw`'s methods live on, or `undefined` where
 * there is no such extension (or no browser at all) — #3287. Found once, on a
 * context of its own that is given straight back: an extension object is not
 * reachable from `WebGL2RenderingContext.prototype`, and its interface has no
 * global name.
 */
export function multiDrawPrototype(): object | undefined {
  if (multiDrawFound === undefined) {
    multiDrawFound = null;
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      const extension = gl?.getExtension('WEBGL_multi_draw') as object | null | undefined;
      if (extension !== null && extension !== undefined) {
        multiDrawFound = Object.getPrototypeOf(extension) as object;
      }
      (gl?.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    } catch {
      // No canvas, no WebGL 2: nothing to wrap.
    }
  }
  return multiDrawFound ?? undefined;
}

/**
 * Calls `seen` for every multi-draw made until the function it returns is
 * called — #3287. Does nothing, and returns a function that does nothing,
 * where there is no `WEBGL_multi_draw`.
 */
export function watchMultiDraws(
  seen: (name: CountedMultiDraw, args: ArrayLike<unknown>) => void,
  prototype: object | undefined = multiDrawPrototype(),
): () => void {
  if (prototype === undefined) return () => undefined;
  const methods = prototype as Record<string, unknown>;
  const originals = new Map<CountedMultiDraw, unknown>();
  for (const name of COUNTED_MULTI_DRAWS) {
    const original = methods[name] as ((...args: unknown[]) => unknown) | undefined;
    if (original === undefined) continue;
    originals.set(name, original);
    methods[name] = function counted(this: unknown, ...args: unknown[]): unknown {
      seen(name, args);
      return original.apply(this, args);
    };
  }
  return () => {
    for (const [name, original] of originals) methods[name] = original;
  };
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
export function drawCounter(
  prototype: object,
  multiDraw: object | undefined = multiDrawPrototype(),
): DrawCounter {
  const methods = prototype as Record<string, unknown>;
  let calls = 0;
  let triangles = 0;
  watchMultiDraws((name, args) => {
    calls += 1;
    triangles += trianglesInMultiDraw(name, args);
  }, multiDraw);
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
