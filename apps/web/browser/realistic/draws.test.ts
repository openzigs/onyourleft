// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  drawCounter,
  GL_TRIANGLES,
  indicesInMultiDraw,
  trianglesInDraw,
  trianglesInMultiDraw,
  watchMultiDraws,
} from './draws';

const LINES = 1;
const UNSIGNED_SHORT = 0x1403;

describe('the triangles a draw call submits — #616', () => {
  it('reads each entry point’s count and instances from where that call puts them', () => {
    expect(trianglesInDraw('drawArrays', [GL_TRIANGLES, 6, 30])).toBe(10);
    expect(trianglesInDraw('drawElements', [GL_TRIANGLES, 36, UNSIGNED_SHORT, 0])).toBe(12);
    expect(trianglesInDraw('drawArraysInstanced', [GL_TRIANGLES, 0, 6, 50])).toBe(100);
    expect(
      trianglesInDraw('drawElementsInstanced', [GL_TRIANGLES, 300, UNSIGNED_SHORT, 12, 7]),
    ).toBe(700);
  });

  it('counts no triangles for a mode three does not count as triangles', () => {
    expect(trianglesInDraw('drawArrays', [LINES, 0, 30])).toBe(0);
    expect(trianglesInDraw('drawElementsInstanced', [LINES, 300, UNSIGNED_SHORT, 0, 7])).toBe(0);
  });

  it('counts an instanced draw of no instances as no triangles, as three does', () => {
    expect(
      trianglesInDraw('drawElementsInstanced', [GL_TRIANGLES, 300, UNSIGNED_SHORT, 0, 0]),
    ).toBe(0);
  });
});

describe('the draw counter — #478, #616', () => {
  /** A stand-in for `WebGL2RenderingContext.prototype`: jsdom has no WebGL. */
  function fakeContext(): {
    prototype: Record<string, (...args: unknown[]) => unknown>;
    reached: string[];
  } {
    const reached: string[] = [];
    const record =
      (name: string) =>
      (...args: unknown[]): unknown => {
        reached.push(`${name}(${args.join(',')})`);
        return name;
      };
    return {
      reached,
      prototype: {
        drawElements: record('drawElements'),
        drawArrays: record('drawArrays'),
        drawElementsInstanced: record('drawElementsInstanced'),
        drawArraysInstanced: record('drawArraysInstanced'),
      },
    };
  }

  it('counts every call and every triangle, and still makes the call', () => {
    const { prototype, reached } = fakeContext();
    const counter = drawCounter(prototype);
    expect(prototype['drawArrays']?.(GL_TRIANGLES, 0, 3)).toBe('drawArrays');
    prototype['drawElementsInstanced']?.(GL_TRIANGLES, 30, UNSIGNED_SHORT, 0, 4);
    prototype['drawArrays']?.(LINES, 0, 30);
    expect(reached).toEqual([
      'drawArrays(4,0,3)',
      `drawElementsInstanced(4,30,${String(UNSIGNED_SHORT)},0,4)`,
      'drawArrays(1,0,30)',
    ]);
    expect(counter.takeCalls()).toBe(3);
    expect(counter.takeTriangles()).toBe(41);
  });

  it('starts each take from nothing', () => {
    const { prototype } = fakeContext();
    const counter = drawCounter(prototype);
    prototype['drawArrays']?.(GL_TRIANGLES, 0, 3);
    counter.takeCalls();
    counter.takeTriangles();
    prototype['drawElements']?.(GL_TRIANGLES, 6, UNSIGNED_SHORT, 0);
    expect(counter.takeCalls()).toBe(1);
    expect(counter.takeTriangles()).toBe(2);
    expect(counter.takeCalls()).toBe(0);
    expect(counter.takeTriangles()).toBe(0);
  });

  it('counts a multi-draw as one call, and the sum of its draws — #3287', () => {
    const { prototype } = fakeContext();
    const made: string[] = [];
    const extension = {
      multiDrawElementsWEBGL: (...args: unknown[]): string => {
        made.push(`elements:${String(args[6])}`);
        return 'made';
      },
      multiDrawArraysWEBGL: (...args: unknown[]): string => {
        made.push(`arrays:${String(args[5])}`);
        return 'made';
      },
    };
    const counter = drawCounter(prototype, extension);
    // Three draws of 30, 60 and 300 indices: one call, 130 triangles.
    const counts = Int32Array.of(999, 30, 60, 300, 999);
    expect(
      extension.multiDrawElementsWEBGL(GL_TRIANGLES, counts, 1, UNSIGNED_SHORT, [0, 0, 0], 0, 3),
    ).toBe('made');
    expect(counter.takeCalls()).toBe(1);
    expect(counter.takeTriangles()).toBe(130);
    // Arrays: the counts are the fourth argument, from the fifth.
    extension.multiDrawArraysWEBGL(GL_TRIANGLES, [0, 0], 0, Int32Array.of(9, 12), 0, 2);
    extension.multiDrawArraysWEBGL(LINES, [0], 0, Int32Array.of(30), 0, 1);
    expect(counter.takeCalls()).toBe(2);
    expect(counter.takeTriangles()).toBe(7);
    expect(made).toEqual(['elements:3', 'arrays:2', 'arrays:1']);
  });

  it('reads a multi-draw’s counts from its offset, for as many draws as it makes', () => {
    const counts = [5, 6, 9, 12];
    expect(
      indicesInMultiDraw('multiDrawElementsWEBGL', [GL_TRIANGLES, counts, 2, 0, [], 0, 2]),
    ).toBe(21);
    expect(indicesInMultiDraw('multiDrawArraysWEBGL', [GL_TRIANGLES, [], 0, counts, 0, 3])).toBe(
      20,
    );
    expect(trianglesInMultiDraw('multiDrawArraysWEBGL', [LINES, [], 0, counts, 0, 3])).toBe(0);
    expect(indicesInMultiDraw('multiDrawArraysWEBGL', [GL_TRIANGLES, [], 0, counts, 0, 0])).toBe(0);
  });

  it('puts a watched multi-draw back as it was, and watches nothing where there is none', () => {
    const real = (): string => 'real';
    const extension = { multiDrawElementsWEBGL: real };
    let seen = 0;
    const stop = watchMultiDraws(() => {
      seen += 1;
    }, extension);
    expect(extension.multiDrawElementsWEBGL).not.toBe(real);
    extension.multiDrawElementsWEBGL();
    stop();
    expect(extension.multiDrawElementsWEBGL).toBe(real);
    expect(seen).toBe(1);
    expect(() => {
      watchMultiDraws(() => undefined, undefined)();
    }).not.toThrow();
  });
});
