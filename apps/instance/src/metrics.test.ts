// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { HttpCounters, labelValue, renderMetrics } from './metrics.ts';

describe('the metrics document — #791', () => {
  it('writes each worker’s riders, rooms, tick lateness and refusals, and the HTTP counts by pattern', () => {
    const http = new HttpCounters();
    http.observe('/v1/rooms/{roomId}/ticket', 200, undefined);
    http.observe('/v1/rooms/{roomId}/ticket', 401, 'unauthenticated');
    http.observe(null, 404, 'not_found');
    const text = renderMetrics(
      [
        {
          index: 0,
          connectedRiders: 3,
          rooms: 1,
          tickLatenessP50Ms: 2,
          tickLatenessP99Ms: 11,
          rssBytes: 1024,
          refusals: { 'too-slow': 1 },
        },
      ],
      http,
    );
    expect(text).toContain('oyl_room_connected_riders{worker="0"} 3');
    expect(text).toContain('oyl_room_tick_lateness_ms{worker="0",quantile="0.99"} 11');
    expect(text).toContain('oyl_room_refusals_total{worker="0",reason="too-slow"} 1');
    expect(text).toContain(
      'oyl_http_requests_total{route="/v1/rooms/{roomId}/ticket",status="401"} 1',
    );
    expect(text).toContain('oyl_http_refusals_total{route="none",reason="not_found"} 1');
  });

  it('refuses to write a label value that could be a name, a coordinate or anything free-form', () => {
    for (const value of ['Ann Rider', '51.501364,-0.14', 'a"b', 'x'.repeat(81), 'é']) {
      expect(() => labelValue(value), value).toThrow(RangeError);
    }
    expect(labelValue('/v1/rooms/{roomId}/ticket')).toBe('/v1/rooms/{roomId}/ticket');
  });
});
