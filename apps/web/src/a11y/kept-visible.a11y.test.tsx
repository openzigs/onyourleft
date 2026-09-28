// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Safety and privacy text is never inside a closed `<details>` — #666's second
 * criterion.
 *
 * #666 tucks each screen's longer explanation into a "More about" disclosure
 * (`design/MoreAbout.tsx`), and the owner's ruling keeps some sentences out of
 * it whatever their length: trainer control, what leaves the device and to
 * whom, what an erase cannot reach, the camera and anyone else in the room,
 * and Web Bluetooth's limits. A closed `<details>` is one press from hidden.
 *
 * Each view that tucks anything lists those sentences in one exported
 * constant, and {@link KEPT} maps every route in the table to its list — a
 * `Record` over `RouteId`, so a route added to the table is a compile error
 * here until somebody says what on it must stay visible, or why nothing does.
 * On first render, over both walk fixtures, every listed sentence must be on
 * its route and must have no closed `<details>` above it (other than being in
 * that disclosure's own summary, which is drawn).
 *
 * And on EVERY route, whatever its list: nothing marked `data-oyl-kept-visible`
 * — the mark the browser gate's fold rule trusts — may sit in a closed
 * disclosure, so the mark cannot be spent on text somebody later tucked.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { StoreHarness } from '@onyourleft/store/testing';

import type { BluetoothPort } from '@onyourleft/sensors/web-bluetooth';

import { OSM_ATTRIBUTION, PUBLISHED_BASEMAP_URL } from '../map/basemap';
import { idleSnapshot, stubRideController } from '../ride/testing';
import { ALL_ROUTES, type RouteDefinition, type RouteId } from '../shell/routes';
import { openRoute } from '../testing/hierarchy-walk';
import { mount, settle, type Mounted } from '../testing/mount';
import { emptyTransferPort } from '../testing/transfer-port';
import { FILES_KEPT_VISIBLE } from '../transfer/TransferView';
import { CAMERA_KEPT_VISIBLE } from '../views/CameraView';
import { DEVICES_KEPT_VISIBLE, DevicesView } from '../views/DevicesView';
import { SETTINGS_KEPT_VISIBLE } from '../views/SettingsView';
import { SIDE_CAMERA_KEPT_VISIBLE } from '../views/SideCameraView';

interface Kept {
  readonly sentences: readonly string[];
  /** Why the walk checks no sentence on this route; required when there are none. */
  readonly reason?: string;
}

const NOTHING_TUCKED = 'nothing on this route is tucked by #666';

/** Every route in the table, and what on it must stay on the screen. */
const KEPT: Record<RouteId, Kept> = {
  settings: { sentences: SETTINGS_KEPT_VISIBLE },
  camera: { sentences: CAMERA_KEPT_VISIBLE },
  'side-camera': { sentences: SIDE_CAMERA_KEPT_VISIBLE },
  transfer: { sentences: FILES_KEPT_VISIBLE },
  devices: {
    sentences: [],
    reason:
      'the walk hands Devices a browser with no Bluetooth, which tucks nothing; the can-pair state, where the disclosure is, is mounted below with DEVICES_KEPT_VISIBLE',
  },
  segments: {
    sentences: [],
    reason:
      'what it tucks is how segments and matching work; the privacy notes about a segment’s visibility are outcome messages, rendered after a save and never in a disclosure',
  },
  home: { sentences: [], reason: NOTHING_TUCKED },
  ride: {
    sentences: [],
    reason: `${NOTHING_TUCKED}: the trainer-control, stall-rescue and recording-service text is left exactly where it was`,
  },
  game: { sentences: [], reason: NOTHING_TUCKED },
  workouts: { sentences: [], reason: NOTHING_TUCKED },
  activities: { sentences: [], reason: NOTHING_TUCKED },
  analysis: { sentences: [], reason: NOTHING_TUCKED },
  routes: { sentences: [], reason: NOTHING_TUCKED },
  about: { sentences: [], reason: `${NOTHING_TUCKED}: it is the page of prose` },
  credits: { sentences: [], reason: `${NOTHING_TUCKED}: it is the page of prose` },
  'route-builder': { sentences: [], reason: NOTHING_TUCKED },
  'activity-detail': { sentences: [], reason: NOTHING_TUCKED },
  'segment-detail': { sentences: [], reason: NOTHING_TUCKED },
  'not-found': { sentences: [], reason: NOTHING_TUCKED },
};

let mounted: Mounted | undefined;
let harness: StoreHarness | undefined;

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  await harness?.destroy();
  harness = undefined;
  globalThis.location.hash = '';
});

function normalise(text: string | null): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** The deepest elements whose text holds `sentence`. */
function holders(root: Element, sentence: string): Element[] {
  return [...root.querySelectorAll('*')].filter(
    (element) =>
      normalise(element.textContent).includes(sentence) &&
      ![...element.children].some((child) => normalise(child.textContent).includes(sentence)),
  );
}

/** The closed `<details>` that hides `element`, or `undefined` when it is drawn. */
function closedAbove(element: Element): Element | undefined {
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    const parent = node.parentElement;
    if (
      parent?.tagName === 'DETAILS' &&
      !parent.hasAttribute('open') &&
      node.tagName !== 'SUMMARY'
    ) {
      return parent;
    }
  }
  return undefined;
}

/** Every fault with a list of sentences on a rendered page. */
function keptVisibleFaults(root: Element, sentences: readonly string[]): string[] {
  const faults: string[] = [];
  for (const sentence of sentences) {
    const found = holders(root, sentence);
    if (found.length === 0) {
      faults.push(`not on the page: “${sentence}”`);
    }
    for (const element of found) {
      const hidden = closedAbove(element);
      if (hidden !== undefined) {
        faults.push(
          `tucked in a closed disclosure (“${normalise(hidden.querySelector('summary')?.textContent ?? '')}”): “${sentence}”`,
        );
      }
    }
  }
  for (const marked of root.querySelectorAll('[data-oyl-kept-visible]')) {
    if (closedAbove(marked) !== undefined) {
      faults.push(`marked data-oyl-kept-visible and tucked: “${normalise(marked.textContent)}”`);
    }
  }
  return faults;
}

async function open(route: RouteDefinition, populated: boolean): Promise<Element> {
  const transfer = await emptyTransferPort();
  harness = transfer.harness;
  mounted = await openRoute(route, populated, undefined, {
    transfer: transfer.port,
    basemap: { archiveUrl: PUBLISHED_BASEMAP_URL, attribution: OSM_ATTRIBUTION },
  });
  expect(document.querySelector('h1')?.textContent).toBe(route.title);
  const main = document.querySelector('main');
  if (main === null) throw new Error('the shell rendered no main');
  return main;
}

describe('#666 — safety and privacy sentences are never in a closed disclosure', () => {
  for (const data of ['empty', 'populated'] as const) {
    for (const route of ALL_ROUTES) {
      it(`${route.id} (${route.path}), ${data}`, async () => {
        const kept = KEPT[route.id];
        if (kept.sentences.length === 0) {
          expect(kept.reason, `${route.id} lists nothing and gives no reason`).toBeTruthy();
        }
        const main = await open(route, data === 'populated');
        expect(keptVisibleFaults(main, kept.sentences)).toEqual([]);
      });
    }
  }

  it('Devices, where a browser can pair: the one-gesture sentence and the limits stay out of its disclosure', async () => {
    const working: BluetoothPort = {
      getAvailability: async () => Promise.resolve(true),
      requestDevice: async () => Promise.reject(new Error('no chooser in a test')),
    };
    mounted = await mount(
      <main>
        <DevicesView
          capabilities={{ bluetooth: working, secureContext: true }}
          controller={stubRideController(idleSnapshot()).controller}
        />
      </main>,
    );
    await settle();
    const main = document.querySelector('main');
    if (main === null) throw new Error('no main');
    expect(main.querySelector('details'), 'the can-pair state has no disclosure').not.toBeNull();
    expect(keptVisibleFaults(main, DEVICES_KEPT_VISIBLE)).toEqual([]);
  });

  it('the rule itself: a listed sentence moved into a closed disclosure is reported', async () => {
    mounted = await mount(
      <main>
        <p>One visible sentence.</p>
        <details>
          <summary>More about it</summary>
          <p>A tucked sentence.</p>
          <div data-oyl-kept-visible="">A marked one.</div>
        </details>
      </main>,
    );
    const main = document.querySelector('main');
    if (main === null) throw new Error('no main');
    expect(keptVisibleFaults(main, ['One visible sentence.', 'More about it'])).toEqual([
      'marked data-oyl-kept-visible and tucked: “A marked one.”',
    ]);
    expect(keptVisibleFaults(main, ['A tucked sentence.', 'Not there at all.'])).toEqual([
      'tucked in a closed disclosure (“More about it”): “A tucked sentence.”',
      'not on the page: “Not there at all.”',
      'marked data-oyl-kept-visible and tucked: “A marked one.”',
    ]);
  });
});
