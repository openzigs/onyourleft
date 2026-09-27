// SPDX-License-Identifier: AGPL-3.0-or-later
// Spike 0015 (#433), throwaway: the sky numbers the realistic renderer reads off the HDR at load,
// computed once on the Mac so the Godot page does not have to load the HDR into the WebView.
import { readFileSync } from 'node:fs';
import { HalfFloatType } from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { it } from 'vitest';

import {
  halfToFloat,
  REALISTIC_HORIZON_BAND,
  skyBandRadiance,
  skySunU,
  upwardRadiance,
  WATER_HORIZON_BAND,
  WATER_ZENITH_BAND,
} from './realistic-light';

it('prints the sky', async () => {
  const buf = readFileSync('public/realistic/farm_field_2k.hdr');
  const parsed = new HDRLoader().parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
  const half = parsed.type === HalfFloatType;
  const data = parsed.data as ArrayLike<number>;
  const sky = {
    width: parsed.width,
    height: parsed.height,
    channel: (i: number) => (half ? halfToFloat(data[i] ?? 0) : (data[i] ?? 0)),
  };
  (await import('node:fs')).writeFileSync('$SPIKE_DIR/sky.txt', [
    'OYL-SKY',
    JSON.stringify({
      w: parsed.width,
      h: parsed.height,
      half,
      upward: upwardRadiance(sky),
      sunU: skySunU(sky),
      skyline: skyBandRadiance(sky, REALISTIC_HORIZON_BAND[0], REALISTIC_HORIZON_BAND[1]),
      zenith: skyBandRadiance(sky, WATER_ZENITH_BAND[0], WATER_ZENITH_BAND[1]),
      horizon: skyBandRadiance(sky, WATER_HORIZON_BAND[0], WATER_HORIZON_BAND[1]),
    }),
  ].join(' '));
});
