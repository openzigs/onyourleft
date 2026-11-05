// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * *Join voice on Discord* on the HUD — #875: audited in the HUD the game
 * mounts, a link named by its own words that says where it goes, reachable by
 * the keyboard, opening in the system's hands, and adding no live region
 * beside the HUD's one (`announce.ts`). When the game shows it is
 * `room-wiring.test.tsx` §"#875"; where it is drawn, the browser gate's
 * (`ride-room.browser.spec.ts` §"#875").
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { auditAccessibility, formatViolations } from '../../a11y/audit';
import { mount, type Mounted } from '../../testing/mount';
import { atStartLine } from '../simulation';
import { HudPanel } from './HudPanel';
import { VoiceNotice } from './VoiceNotice';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function route(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 20; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return routeProfile(points);
}

const INVITE = 'https://discord.gg/inv1abc';

async function hud(withVoice: boolean): Promise<void> {
  const profile = route();
  mounted = await mount(
    <main>
      <h1>Ride</h1>
      <HudPanel
        profile={profile}
        state={atStartLine(profile)}
        cadence={{ value: 88, live: true }}
        heartRate={{ value: 150, live: true }}
        onPause={() => undefined}
        onEnd={() => undefined}
        paused={false}
        announcement=""
        room={{ nearby: 2 }}
        onFollowNext={() => undefined}
        notices={withVoice ? [<VoiceNotice key="voice" invite={INVITE} />] : []}
      />
    </main>,
  );
}

const liveRegions = (): Element[] =>
  [...document.querySelectorAll('*')].filter(
    (each) =>
      each.hasAttribute('aria-live') ||
      ['status', 'log', 'alert', 'timer', 'marquee'].includes(each.getAttribute('role') ?? ''),
  );

const voiceLink = (): HTMLAnchorElement | undefined =>
  [...document.querySelectorAll<HTMLAnchorElement>('a')].find(
    (each) => each.textContent === 'Join voice on Discord',
  );

describe('Join voice on Discord on the HUD — #875', () => {
  it('audits clean, and adds no live region', async () => {
    await hud(false);
    const regions = liveRegions().length;
    mounted?.unmount();
    await hud(true);
    expect(voiceLink()).toBeDefined();
    expect(formatViolations(auditAccessibility(document))).toBe('');
    expect(liveRegions()).toHaveLength(regions);
  });

  it('is a link named by its own words, which say it is Discord, followed by words that say it opens Discord', async () => {
    await hud(true);
    const link = voiceLink();
    expect(link?.getAttribute('href')).toBe(INVITE);
    // Its accessible name is its text: no aria-label to drift from what is seen (SC 2.5.3).
    expect(link?.hasAttribute('aria-label')).toBe(false);
    expect(link?.closest('.oyl-status')?.textContent).toContain(
      'Join voice on Discord (opens Discord)',
    );
  });

  it('opens in the system’s hands, tells Discord nothing of where it came from, and is in the keyboard’s order', async () => {
    await hud(true);
    const link = voiceLink();
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noreferrer');
    expect(link?.tabIndex).toBe(0);
    link?.focus();
    expect(document.activeElement).toBe(link);
  });
});
