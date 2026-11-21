// SPDX-License-Identifier: Apache-2.0

/**
 * The agent template, version 2 (#2840): the digest that stops it changing
 * silently, its low temperature, its worked paragraph, and that everything it
 * shares with version 1 is version 1's own.
 */

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { UntrustedText } from '../screen/model-answer';
import { passedScreen, screenWriteUp, type ScreenReason } from '../screen/write-up-screen';
import { ANALYSIS_AGENT_TEMPLATE_V1, fenceData } from './agent-v1';
import { AGENT_V2_TEMPERATURE, ANALYSIS_AGENT_TEMPLATE_V2 } from './agent-v2';
import { LARGEST, ORDINARY, SMALLEST } from './template-fixtures-testing';

const EVERY_REASON: readonly ScreenReason[] = [
  'empty',
  'too-long',
  'ill-formed',
  'control-character',
  'angle-sign',
  'angle-word',
  'body-sideways',
];

function digest(): string {
  const template = ANALYSIS_AGENT_TEMPLATE_V2;
  return createHash('sha256')
    .update(
      JSON.stringify([
        template.id,
        template.version,
        template.system,
        template.temperature,
        template.thinking,
        ...[LARGEST, ORDINARY, SMALLEST].map((input) => template.firstMessage(input)),
        ...EVERY_REASON.map((reason) => template.rewrite([reason])),
        template.rewrite([]),
        template.rewrite(EVERY_REASON),
        fenceData('a [b] c\nd'),
      ]),
    )
    .digest('hex');
}

/**
 * ⚠️ **A red case here means a shipped version changed.** Put the words back
 * and write the change as a version 3 in a file of its own; do not update the
 * digest.
 */
const RECORDED_DIGEST = '7d2de3f2d1be673e1e3d7e8569470f4d841202aa5b0df982424e857bc62bc6fd';

describe('the agent template, version 2', () => {
  it('has not changed since it shipped', () => {
    expect(digest()).toBe(RECORDED_DIGEST);
  });

  it('is version 2 of the same template, at a low temperature', () => {
    expect(ANALYSIS_AGENT_TEMPLATE_V2.id).toBe(ANALYSIS_AGENT_TEMPLATE_V1.id);
    expect(ANALYSIS_AGENT_TEMPLATE_V2.version).toBe('2');
    expect(ANALYSIS_AGENT_TEMPLATE_V2.temperature).toBe(AGENT_V2_TEMPERATURE);
    expect(ANALYSIS_AGENT_TEMPLATE_V2.thinking).toBe('off');
    expect(ANALYSIS_AGENT_TEMPLATE_V1.thinking).toBeUndefined();
    expect(AGENT_V2_TEMPERATURE).toBeGreaterThan(0);
    expect(AGENT_V2_TEMPERATURE).toBeLessThanOrEqual(0.5);
    // Version 1 is frozen at the model's own default.
    expect(ANALYSIS_AGENT_TEMPLATE_V1.temperature).toBeUndefined();
  });

  it('sends version 1’s first message and rewrite, word for word', () => {
    for (const input of [LARGEST, ORDINARY, SMALLEST]) {
      expect(ANALYSIS_AGENT_TEMPLATE_V2.firstMessage(input)).toBe(
        ANALYSIS_AGENT_TEMPLATE_V1.firstMessage(input),
      );
    }
    expect(ANALYSIS_AGENT_TEMPLATE_V2.rewrite(EVERY_REASON)).toBe(
      ANALYSIS_AGENT_TEMPLATE_V1.rewrite(EVERY_REASON),
    );
  });

  it('keeps every rule version 1 states, and says what version 1 does not', () => {
    for (const sentence of ANALYSIS_AGENT_TEMPLATE_V1.system.split(/(?<=\.) /)) {
      // Version 1's three sentences about its tools, which version 2 rewrites to name all five.
      if (/^(You may call tools|You do not have to call any|Use the other rides)/.test(sentence)) {
        continue;
      }
      expect(ANALYSIS_AGENT_TEMPLATE_V2.system, sentence).toContain(sentence);
    }
    expect(ANALYSIS_AGENT_TEMPLATE_V2.system).toContain('It is an example only');
  });

  it('gives a worked paragraph the write-up screen would pass', () => {
    const quoted = /"([^"]+)"/.exec(ANALYSIS_AGENT_TEMPLATE_V2.system)?.[1];
    expect(quoted).toBeDefined();
    expect(passedScreen(screenWriteUp(quoted as UntrustedText))).toBe(true);
  });
});
