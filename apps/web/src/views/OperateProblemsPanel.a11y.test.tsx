// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Operate area's Recent problems (#2614), audited in each state it
 * draws: lines with each one's disclosure shut and open, none since the
 * instance started, and a list that could not be read. Each line's *The line
 * as logged* is an `.oyl-details` summary, which declares the project's
 * touch-target row (`theme.css`).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { scriptedOperate, type ScriptedOperate } from '../instance/testing';
import { mount, settle, type Mounted } from '../testing/mount';
import { OperateProblemsPanel } from './OperateProblemsPanel';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function open(scripted: ScriptedOperate): Promise<void> {
  mounted = await mount(
    <main>
      <h1>Operate</h1>
      <OperateProblemsPanel timeZone="UTC" port={scripted.port} />
    </main>,
  );
  await settle();
}

const audit = (): string => formatViolations(auditAccessibility(document));

describe('the Operate area’s Recent problems — #2614', () => {
  it('passes the audit with the lines, shut and open, each disclosure a details row', async () => {
    await open(scriptedOperate());
    expect(audit()).toBe('');
    const disclosures = [...document.querySelectorAll<HTMLDetailsElement>('main li details')];
    expect(disclosures).toHaveLength(3);
    for (const each of disclosures) {
      expect(each.classList.contains('oyl-details')).toBe(true);
      each.open = true;
    }
    expect(audit()).toBe('');
    expect([...document.querySelectorAll('main h2')].map((each) => each.textContent)).toEqual([
      'Recent problems',
    ]);
  });

  it('passes the audit with none since the instance started, and when they could not be read', async () => {
    await open(scriptedOperate({ problems: [] }));
    expect(audit()).toBe('');
    mounted?.unmount();
    await open(scriptedOperate({ problems: null }));
    expect(audit()).toBe('');
  });
});
