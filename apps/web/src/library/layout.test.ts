// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { libraryLayout, TABLE_FROM_REM } from './layout';

describe('libraryLayout — #660', () => {
  it('is a card list below the width the columns need, and a table from it', () => {
    expect(libraryLayout(TABLE_FROM_REM * 16 - 0.5, 16)).toBe('cards');
    expect(libraryLayout(TABLE_FROM_REM * 16, 16)).toBe('table');
  });

  it('scales with the rider’s text size, so larger text gets the list sooner', () => {
    const width = TABLE_FROM_REM * 16;
    expect(libraryLayout(width, 16)).toBe('table');
    expect(libraryLayout(width, 20)).toBe('cards');
  });

  it('is a table where nothing measured the container, which is jsdom', () => {
    expect(libraryLayout(undefined, 16)).toBe('table');
  });

  it('is a table rather than a guess when the root font size is unreadable', () => {
    expect(libraryLayout(300, Number.NaN)).toBe('table');
    expect(libraryLayout(300, 0)).toBe('table');
  });

  it('puts every phone the reflow walk measures below the line, by a margin', () => {
    // 390 px is the widest phone #660 names upright; the library gets less
    // than that once `main` is padded, so the line must sit above it.
    expect(TABLE_FROM_REM * 16).toBeGreaterThan(390);
  });
});
