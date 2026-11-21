// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Operate area's Recent problems (#2614): over the scripted port for what
 * the screen does with each answer, and over the REAL instance
 * (`testing/operate-instance-testing.ts`), whose problem lines are written
 * through its own sink as the instance writes them.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createOperatePort } from '../instance/operate-port';
import { scriptedOperate } from '../instance/testing';
import {
  closeOperateWorlds,
  operatedWorld,
  writeInstanceLine,
} from '../testing/operate-instance-testing';
import { mount, settle, type Mounted } from '../testing/mount';
import { OperateProblemsPanel, PROBLEMS_UNREADABLE_TEXT } from './OperateProblemsPanel';

let mounted: Mounted | undefined;

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  await closeOperateWorlds();
});

function text(of: ParentNode | null | undefined = mounted?.container): string {
  return (of?.textContent ?? '').replace(/\s+/g, ' ');
}

/** Each line's sentence, top to bottom, without the line as logged. */
function sentences(): string[] {
  return [...(mounted?.container.querySelectorAll('.oyl-operate__problems > li') ?? [])].map(
    (each) => {
      const copy = each.cloneNode(true) as HTMLElement;
      copy.querySelector('details')?.remove();
      return text(copy).trim();
    },
  );
}

async function show(port: Parameters<typeof OperateProblemsPanel>[0]['port']): Promise<void> {
  mounted = await mount(<OperateProblemsPanel timeZone="UTC" port={port} />);
  for (let turn = 0; turn < 200 && text().includes('Reading the recent'); turn += 1) {
    await settle();
  }
  await settle();
}

describe('the Recent problems section over the scripted instance — #2614', () => {
  it('says each line as a sentence with its time, newest first, and since when', async () => {
    await show(scriptedOperate().port);
    expect(text()).toContain(
      'Problems since the instance last started, 2026-11-14 08:00 UTC, newest first.',
    );
    expect(sentences()).toEqual([
      '2026-11-14 20:45 UTC: A request to /v1/rooms/{roomId}/route was answered 503.',
      '2026-11-14 20:30 UTC: A room worker stopped, and the 2 rooms on it were lost.',
      '2026-11-14 19:10 UTC: An analysis job failed (model-unreachable).',
    ]);
  });

  it('shows the line exactly as logged on request, behind its own disclosure', async () => {
    const scripted = scriptedOperate();
    await show(scripted.port);
    const first = mounted?.container.querySelector('.oyl-operate__problems > li details');
    expect(first?.querySelector('summary')?.textContent).toBe('The line as logged');
    expect(first?.hasAttribute('open')).toBe(false);
    expect(first?.querySelector('code')?.textContent).toBe(scripted.held.problems?.[0]?.line);
  });

  it('says there has been none since the instance started, and when it could not be read', async () => {
    await show(scriptedOperate({ problems: [] }).port);
    expect(text()).toContain('No problem since the instance last started, 2026-11-14 08:00 UTC.');
    mounted?.unmount();
    await show(scriptedOperate({ problems: null }).port);
    expect(text()).toContain(PROBLEMS_UNREADABLE_TEXT);
  });
});

describe('the Recent problems section over the real instance — #2614', () => {
  it('shows the instance’s own redacted line: the time, the sentence, and no coordinate or secret', async () => {
    const { owner, world } = await operatedWorld();
    await writeInstanceLine(world, 'room-worker-died', {
      worker: 0,
      roomsLost: 1,
      lat: 51.50735,
      lon: -0.12776,
      token: 'a-session-token-2614',
    });
    await show(createOperatePort(owner.dependencies));
    expect(sentences()).toEqual([
      `${new Date(world.clock.ms).toISOString().slice(0, 16).replace('T', ' ')} UTC: A room worker stopped, and the 1 room on it was lost.`,
    ]);
    const shown = text();
    for (const absent of ['51.50735', '0.12776', 'a-session-token-2614']) {
      expect(shown).not.toContain(absent);
    }
    expect(world.instance.lines).toContain(
      mounted?.container.querySelector('.oyl-operate__problems code')?.textContent,
    );
  });
});
