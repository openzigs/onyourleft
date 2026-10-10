// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Every tool the agent has is one the rider is told about** — #1104's third
 * criterion, the instance half.
 *
 * `@onyourleft/analysis` §`AGENT_TOOL_DISCLOSURES` names, for each tool, the
 * phrases the hosted consent and the instance paragraph describe its results
 * with. This holds its keys to {@link AGENT_TOOLS}, exactly: a tool added
 * without an entry (#1099, #1100) is a red build, and so is an entry left for
 * a tool that is gone. The web half — every phrase in the shipped words — is
 * `apps/web/src/ride-analysis/sent-fields.test.ts`, extended by the pull
 * request that ships those words (#1102).
 */

import { describe, expect, it } from 'vitest';

import { AGENT_TOOL_DISCLOSURES } from '@onyourleft/analysis';

import { AGENT_TOOLS } from './tools.ts';

const toolNames = AGENT_TOOLS.map((tool) => tool.spec.name);

describe('the agent’s tools, against what the rider is told (#1104)', () => {
  it('reads the tools at all', () => {
    // The vacuous pass: no tools would be a table that names every one.
    expect(toolNames.length).toBeGreaterThanOrEqual(3);
    expect(toolNames).toContain('goals');
  });

  it('names what every tool returns', () => {
    const unnamed = toolNames.filter((name) => !Object.hasOwn(AGENT_TOOL_DISCLOSURES, name));
    expect(
      unnamed,
      'a tool the agent has is named by no disclosure: draft its wording on #1104, then add it to AGENT_TOOL_DISCLOSURES',
    ).toStrictEqual([]);
  });

  it('names no tool the agent does not have', () => {
    const stale = Object.keys(AGENT_TOOL_DISCLOSURES).filter((name) => !toolNames.includes(name));
    expect(stale, 'a disclosure entry for a tool that is gone').toStrictEqual([]);
  });

  it('gives every tool at least one phrase, and no phrase of one word — #847', () => {
    for (const [name, phrases] of Object.entries(AGENT_TOOL_DISCLOSURES)) {
      expect(phrases.length, name).toBeGreaterThan(0);
      for (const phrase of phrases) {
        expect(/\s/.test(phrase.trim()), `${name}: "${phrase}"`).toBe(true);
      }
    }
  });
});
