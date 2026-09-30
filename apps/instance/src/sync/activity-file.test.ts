// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { sniffActivityFile } from './activity-file.ts';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('reading a file’s type from its bytes (#37)', () => {
  it.each([
    ['<?xml version="1.0"?><gpx version="1.1">', 'gpx'],
    ['<?xml version="1.0"?>\n<!-- <gpx> in a comment --><TrainingCenterDatabase xmlns="x">', 'tcx'],
    ['<?xml version="1.0"?><?style a="<gpx>"?><gpx:gpx xmlns:gpx="x">', 'gpx'],
    ['<!-- a comment that never ends <gpx>', undefined],
    ['<kml><gpx></gpx></kml>', undefined],
    ['just text', undefined],
  ])('%s → %s', (document, kind) => {
    expect(sniffActivityFile(text(document))).toBe(kind);
  });
});
