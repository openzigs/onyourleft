// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { drawCounter, GL_TRIANGLES, trianglesInDraw } from './draws';

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
});
