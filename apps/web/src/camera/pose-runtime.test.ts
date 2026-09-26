// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The rules the pose worker runs under** — #530. The worker itself is only
 * reachable in a real engine (`browser/pose.browser.spec.ts`); everything it
 * decides is here.
 */

import { describe, expect, it } from 'vitest';

import {
  fenceWorkerNetwork,
  FENCED_REQUEST_MESSAGE,
  onOrigin,
  poseAssetUrl,
  poseOutcomeOf,
  poseReplyFrom,
  POSE_MODEL_FILE,
  type FencedRequestPrototype,
  type FencedScope,
} from './pose-runtime';
import { MODEL_LANDMARK_COUNT, MODEL_VALUES_PER_LANDMARK } from './pose-landmarks';

const ORIGIN = 'https://localhost';

/** A worker scope that records what reached the network through it. */
function scope(): FencedScope & {
  readonly reached: string[];
  readonly opened: string[];
  readonly Request: new () => { open(method: string, url: string, async?: boolean): void };
  readonly requestPrototype: FencedRequestPrototype;
} {
  const reached: string[] = [];
  const opened: string[] = [];
  class Request {
    open(method: string, url: string | URL): void {
      opened.push(`${method} ${String(url)}`);
    }
  }
  return {
    reached,
    opened,
    location: { origin: ORIGIN },
    fetch: async (input: unknown) => {
      reached.push(input instanceof URL ? input.href : String(input));
      return Promise.resolve('ok');
    },
    Request,
    requestPrototype: Request.prototype,
  };
}

describe('where the model is', () => {
  it('is under the app’s own base, on its own origin', () => {
    expect(poseAssetUrl(POSE_MODEL_FILE, '/', ORIGIN)).toBe(
      'https://localhost/pose/pose_landmarker_lite.task',
    );
    expect(poseAssetUrl(POSE_MODEL_FILE, '/app/', 'https://example.test')).toBe(
      'https://example.test/app/pose/pose_landmarker_lite.task',
    );
  });
});

describe('the fence — what the worker may reach', () => {
  it('lets a request to its own origin through, relative or absolute', async () => {
    const fenced = scope();
    fenceWorkerNetwork(fenced, fenced.requestPrototype);
    await fenced.fetch('/pose/pose_landmarker_lite.task');
    await fenced.fetch(new URL('https://localhost/pose/vision_wasm_module_internal.wasm'));
    expect(fenced.reached).toEqual([
      '/pose/pose_landmarker_lite.task',
      'https://localhost/pose/vision_wasm_module_internal.wasm',
    ]);
  });

  it('refuses MediaPipe’s usage log, and anything else off the origin, before it is sent', async () => {
    const fenced = scope();
    fenceWorkerNetwork(fenced, fenced.requestPrototype);
    await expect(fenced.fetch('https://odml.pa.googleapis.com/v1/log')).rejects.toThrow(
      FENCED_REQUEST_MESSAGE,
    );
    await expect(fenced.fetch('http://localhost/pose/x')).rejects.toThrow();
    await expect(fenced.fetch('https://localhost.evil.test/x')).rejects.toThrow();
    expect(fenced.reached).toEqual([]);
  });

  it('names no URL in what it refuses with (ADR 0029 D-8)', async () => {
    const fenced = scope();
    fenceWorkerNetwork(fenced, fenced.requestPrototype);
    const refusal = await fenced
      .fetch('https://odml.pa.googleapis.com/v1/log')
      .catch((error: unknown) => String(error));
    expect(refusal).not.toContain('googleapis');
  });

  it('fences the older request object too', () => {
    const fenced = scope();
    fenceWorkerNetwork(fenced, fenced.requestPrototype);
    const { Request } = fenced;
    new Request().open('GET', '/pose/vision_wasm_module_internal.wasm', false);
    expect(() => {
      new Request().open('POST', 'https://odml.pa.googleapis.com/v1/log');
    }).toThrow(FENCED_REQUEST_MESSAGE);
    expect(fenced.opened).toEqual(['GET /pose/vision_wasm_module_internal.wasm']);
  });

  it('reads the URL off a request object, and refuses one it cannot read', async () => {
    const fenced = scope();
    fenceWorkerNetwork(fenced, fenced.requestPrototype);
    await expect(fenced.fetch({ url: 'https://odml.pa.googleapis.com/v1/log' })).rejects.toThrow(
      FENCED_REQUEST_MESSAGE,
    );
    await expect(fenced.fetch({ url: 42 })).rejects.toThrow(FENCED_REQUEST_MESSAGE);
    await expect(fenced.fetch(undefined)).rejects.toThrow(FENCED_REQUEST_MESSAGE);
    expect(fenced.reached).toEqual([]);
  });

  it('treats a URL it cannot read as off the origin', () => {
    expect(onOrigin('http://[', ORIGIN)).toBe(false);
    expect(onOrigin('/fine', ORIGIN)).toBe(true);
  });
});

describe('what the worker says back', () => {
  const values = Array.from({ length: MODEL_LANDMARK_COUNT * MODEL_VALUES_PER_LANDMARK }, () => 0);

  it('reads each kind of reply', () => {
    expect(poseReplyFrom({ id: 3, kind: 'landmarks', width: 256, height: 160, values })).toEqual({
      id: 3,
      kind: 'landmarks',
      width: 256,
      height: 160,
      values,
    });
    expect(poseReplyFrom({ id: 4, kind: 'unreadable' })).toEqual({ id: 4, kind: 'unreadable' });
    expect(poseReplyFrom({ id: 5, kind: 'unavailable' })).toEqual({ id: 5, kind: 'unavailable' });
  });

  it('refuses a reply with no id, an unknown kind, or values that are not numbers', () => {
    expect(poseReplyFrom(null)).toBeUndefined();
    expect(poseReplyFrom({ kind: 'unreadable' })).toBeUndefined();
    expect(poseReplyFrom({ id: 1.5, kind: 'unreadable' })).toBeUndefined();
    expect(poseReplyFrom({ id: 1, kind: 'described' })).toBeUndefined();
    expect(
      poseReplyFrom({ id: 1, kind: 'landmarks', width: 1, height: 1, values: ['0'] }),
    ).toBeUndefined();
    expect(poseReplyFrom({ id: 1, kind: 'landmarks', width: 1, values: [] })).toBeUndefined();
  });

  it('turns a reply into an outcome', () => {
    expect(
      poseOutcomeOf({ id: 1, kind: 'landmarks', width: 256, height: 256, values: [] }),
    ).toEqual({ kind: 'no-rider' });
    expect(poseOutcomeOf({ id: 1, kind: 'unreadable' })).toEqual({ kind: 'unreadable' });
    expect(poseOutcomeOf({ id: 1, kind: 'unavailable' })).toEqual({ kind: 'unavailable' });
  });
});
