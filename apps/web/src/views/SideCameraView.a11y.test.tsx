// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The side-camera screen in the accessibility gate, in every state it has —
 * #528.
 *
 * `routes.a11y.test.tsx` audits the route with no camera port, which is the
 * explanatory screen and nothing else. This file audits the four states a
 * rider actually meets: the consent, the framing picture, the filming sign
 * (which runs with the shell's chrome absent, so it is the whole page), and
 * *"stopped, link lost"*.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { CameraController } from '../camera/session';
import { LINK_LOSS_LIMIT_MILLISECONDS } from '../camera/side-camera';
import { manualSchedule, scriptedCamera, scriptedLink, virtualTime } from '../camera/testing';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';

import { SideCameraView } from './SideCameraView';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

function expectNoViolations(what: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : formatViolations(violations), what).toBe('');
}

async function press(text: string): Promise<void> {
  const found = queryAll<HTMLButtonElement>(document, 'button').find((each) =>
    (each.textContent ?? '').includes(text),
  );
  if (found === undefined) {
    expect.unreachable(`no button "${text}"`);
    return;
  }
  await activateWithKeyboard(found);
  await settle();
}

async function acknowledge(): Promise<void> {
  queryAll<HTMLInputElement>(document, 'input[type="checkbox"]')[0]?.click();
  await settle();
}

/**
 * The screen inside a page with a `main` and an `h1`, the way the shell
 * frames it — with a link, which the shell does not hand it in this build.
 */
async function pagedWithLink(): Promise<{
  readonly link: ReturnType<typeof scriptedLink>;
  readonly time: ReturnType<typeof virtualTime>;
}> {
  const camera = scriptedCamera();
  const controller = new CameraController({
    port: camera.port,
    schedule: manualSchedule().schedule,
  });
  const link = scriptedLink();
  const time = virtualTime();
  mounted = await mount(
    <main aria-labelledby="title">
      <h1 id="title">Side camera</h1>
      <SideCameraView controller={controller} link={link} timers={time} />
    </main>,
  );
  await settle();
  return { link, time };
}

describe('the side-camera screen', () => {
  it('passes the audit before the camera is on, in the shell', async () => {
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
    });
    globalThis.location.hash = '#/camera/side';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} camera={controller} />);
    await settle();
    expect(document.body.textContent).toContain('Before the camera is on');
    expectNoViolations('the side camera’s consent has accessibility violations');
  });

  it('passes the audit while framing, unpaired, in the shell', async () => {
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
    });
    globalThis.location.hash = '#/camera/side';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} camera={controller} />);
    await settle();
    await acknowledge();
    await press('Turn the camera on');
    expect(document.querySelector('video')).not.toBeNull();
    expectNoViolations('the framing screen has accessibility violations');
  });

  it('passes the audit while filming, with the link lost and counting down', async () => {
    const { link } = await pagedWithLink();
    await acknowledge();
    await press('Turn the camera on');
    link.emit({ kind: 'start' });
    link.emit({ kind: 'condition', condition: 'lost' });
    await settle();
    expect(document.querySelector('[role="timer"]')).not.toBeNull();
    expectNoViolations('the filming sign has accessibility violations');
  });

  it('passes the audit once it has stopped, link lost', async () => {
    const { link, time } = await pagedWithLink();
    await acknowledge();
    await press('Turn the camera on');
    link.emit({ kind: 'start' });
    link.emit({ kind: 'condition', condition: 'lost' });
    time.advance(LINK_LOSS_LIMIT_MILLISECONDS);
    await settle();
    expect(document.body.textContent).toContain('Stopped, link lost.');
    expectNoViolations('the stopped screen has accessibility violations');
  });

  it('carries the sign in words, so removing the colour removes nothing', async () => {
    const { link } = await pagedWithLink();
    await acknowledge();
    await press('Turn the camera on');
    link.emit({ kind: 'start' });
    await settle();
    const sign = document.querySelector('[data-oyl-side-camera-indicator]');
    expect(sign?.textContent).toMatch(/Filming/);
    expect(sign?.textContent).toMatch(/Camera on/);
  });
});
