// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { noProblemsText, problemSentence, problemsSinceText } from './problems';

describe('the Recent problems section’s words — #2614', () => {
  it('says each problem line in words, from its closed fields', () => {
    expect(problemSentence({ event: 'request', route: '/v1/rooms', status: 503 })).toBe(
      'A request to /v1/rooms was answered 503.',
    );
    expect(problemSentence({ event: 'unhandled', route: null, error: 'TypeError' })).toBe(
      'A request to an address with no route failed inside the instance (TypeError).',
    );
    expect(problemSentence({ event: 'room-worker-died', roomsLost: 2 })).toBe(
      'A room worker stopped, and the 2 rooms on it were lost.',
    );
    expect(problemSentence({ event: 'room-worker-died', roomsLost: 1 })).toBe(
      'A room worker stopped, and the 1 room on it was lost.',
    );
    expect(
      problemSentence({ event: 'analysis-job', state: 'failed', code: 'model-unreachable' }),
    ).toBe('An analysis job failed (model-unreachable).');
    expect(problemSentence({ event: 'instance-keys', state: 'unreadable' })).toBe(
      'The instance’s keys are not ready: the secret key set does not open them.',
    );
    expect(problemSentence({ event: 'hosted-model-key', state: 'no-secret' })).toContain(
      'OYL_INSTANCE_SECRET_KEY is not set',
    );
  });

  it('never says a redacted value, and names an event it does not know by its own name', () => {
    expect(problemSentence({ event: 'voice-failed', code: '[redacted]' })).toBe(
      'A request to Discord failed.',
    );
    expect(problemSentence({ event: 'something-new' })).toBe('something-new.');
  });

  it('says since when the list runs', () => {
    expect(problemsSinceText('2026-11-15 08:00 UTC')).toBe(
      'Problems since the instance last started, 2026-11-15 08:00 UTC, newest first.',
    );
    expect(noProblemsText('2026-11-15 08:00 UTC')).toBe(
      'No problem since the instance last started, 2026-11-15 08:00 UTC.',
    );
  });
});
