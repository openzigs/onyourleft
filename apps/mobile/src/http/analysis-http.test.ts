// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import {
  ANALYSIS_CONNECT_TIMEOUT_MILLISECONDS,
  ANALYSIS_READ_TIMEOUT_MILLISECONDS,
  bodyText,
  capacitorAnalysisPost,
  type NativeHttp,
} from './analysis-http';

function scripted(reply: { status: number; data: unknown } | Error): {
  http: NativeHttp;
  request: ReturnType<typeof vi.fn>;
} {
  const request = vi.fn(async () =>
    reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply),
  );
  return { http: { request }, request };
}

const REQUEST = {
  url: 'http://192.168.1.20:8080/v1/chat/completions',
  headers: { 'Content-Type': 'application/json' },
  json: { model: 'm', messages: [] },
} as const;

describe('the native analysis request — #553', () => {
  it('is a POST that follows no redirect, to exactly the URL it was given, with the body as JSON', async () => {
    const { http, request } = scripted({ status: 200, data: '{"ok":1}' });
    await capacitorAnalysisPost(http)(REQUEST);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      url: REQUEST.url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: REQUEST.json,
      responseType: 'text',
      disableRedirects: true,
      connectTimeout: ANALYSIS_CONNECT_TIMEOUT_MILLISECONDS,
      readTimeout: ANALYSIS_READ_TIMEOUT_MILLISECONDS,
    });
  });

  it('hands back the status and the body as text, whether the native layer parsed it or not', async () => {
    await expect(
      capacitorAnalysisPost(scripted({ status: 200, data: 'plain' }).http)(REQUEST),
    ).resolves.toEqual({ status: 200, body: 'plain' });
    await expect(
      capacitorAnalysisPost(scripted({ status: 404, data: { a: [1] } }).http)(REQUEST),
    ).resolves.toEqual({ status: 404, body: '{"a":[1]}' });
  });

  it('rejects when the native layer does', async () => {
    await expect(
      capacitorAnalysisPost(scripted(new Error('no route to 192.168.1.20')).http)(REQUEST),
    ).rejects.toThrow();
  });

  it('reads a missing or unserialisable body as empty', () => {
    expect(bodyText(undefined)).toBe('');
    expect(bodyText(null)).toBe('');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(bodyText(circular)).toBe('');
  });
});
