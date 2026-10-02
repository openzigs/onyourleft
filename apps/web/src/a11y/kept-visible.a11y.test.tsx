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
 * disclosure, so the mark cannot be spent on text somebody later tucked; and
 * since #699's review (B1) every sentence under the mark must be one of the
 * route's own lists, so it cannot be sprinkled onto ordinary prose to buy a
 * first control a place below the fold. Nor may any summary hold a heading
 * (N5), wherever it came from.
 *
 * States the walk does not reach are mounted on their own below: Devices where
 * a browser can pair, the Camera agreed to, and the Ride screen with a
 * controlled trainer eased and not released, and with control lost (N1).
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { StoreHarness } from '@onyourleft/store/testing';

import { watts } from '@onyourleft/domain';
import type { BluetoothPort } from '@onyourleft/sensors/web-bluetooth';

import { CameraController } from '../camera/session';
import { manualSchedule, scriptedCamera } from '../camera/testing';

import { OSM_ATTRIBUTION, PUBLISHED_BASEMAP_URL } from '../map/basemap';
import {
  KEEP_SCREEN_ON_LABEL,
  RIDE_MAY_STOP_WITH_SCREEN_OFF,
  RIDE_NOTIFICATION_REFUSED,
} from '../ride/controller';
import { idleSnapshot, ridingSnapshot, stubRideController } from '../ride/testing';
import { LOSS_REASON } from '../ride/TrainerPanel';
import { ALL_ROUTES, routeById, type RouteDefinition, type RouteId } from '../shell/routes';
import { openRoute } from '../testing/hierarchy-walk';
import { mount, settle, type Mounted } from '../testing/mount';
import { sentencesIn } from '../testing/route-sentences';
import { emptyTransferPort } from '../testing/transfer-port';
import { FILES_KEPT_VISIBLE } from '../transfer/TransferView';
import { CAMERA_AGREED_KEPT_VISIBLE, CAMERA_KEPT_VISIBLE, CameraView } from '../views/CameraView';
import { DEVICES_KEPT_VISIBLE, DevicesView } from '../views/DevicesView';
import { COMPUTER_SENDS, COMPUTER_SENDS_LEAD } from '../detail/write-up';
import { WRITE_UP_EXPLANATION } from '../ride-analysis/RideWriteUpControl';
import { RACE_CONSENT_SENTENCE } from '../detail/RaceConsentSection';
import { RIDER_TEXT_KEPT_VISIBLE } from '../rider-text/disclosure';
import { RideView } from '../views/RideView';
import { SETTINGS_KEPT_VISIBLE } from '../views/SettingsView';
import { INSTANCE_CONNECTED_KEPT_VISIBLE, INSTANCE_KEPT_VISIBLE } from '../views/InstanceView';
import { MODERATION_KEPT_VISIBLE } from '../views/ModerationView';
import { SIDE_CAMERA_KEPT_VISIBLE } from '../views/SideCameraView';

interface Kept {
  /** Checked on the walk over BOTH fixtures. */
  readonly sentences: readonly string[];
  /** Checked on the populated walk only: the empty fixture does not render them. */
  readonly populated?: readonly string[];
  /**
   * In the view's list, and rendered only in a state neither walk reaches — each
   * is checked by a mounted case below, named in {@link reason}. They still
   * bound the `data-oyl-kept-visible` mark on this route (B1 of #699's review).
   */
  readonly elsewhere?: readonly string[];
  /** Why the walk checks no sentence on this route, or where `elsewhere` is checked. */
  readonly reason?: string;
}

const NOTHING_TUCKED = 'nothing on this route is tucked by #666';

/**
 * The Ride screen tucks nothing, and its safety text is listed here so that it
 * cannot be tucked later with every gate green (#699's review, N1): #666's
 * second criterion names trainer-control text first. Written here rather than
 * in `views/RideView.tsx` because the sentences live in `ride/`, which the
 * wiring gate watches (§4j), and a list only this test reads is not product
 * code. Fragments where a sentence carries a number.
 */
const RIDE_KEPT_VISIBLE: readonly string[] = ['Everything stays on this device.'];

/** What the populated walk's Ride screen renders: a trainer under this app's control, in ERG. */
const RIDE_POPULATED_KEPT_VISIBLE: readonly string[] = [
  'This app has control of the trainer.',
  'ERG, optional:',
  'A target is quantised to that step before it is written.',
  'A workout’s targets are a share of it, so there is no number to send without one.',
];

/** A controlled trainer the stall rescue has eased, whose release was refused, mid-ride. */
const RIDE_CONTROLLED_KEPT_VISIBLE: readonly string[] = [
  ...RIDE_POPULATED_KEPT_VISIBLE,
  'Not released',
  'Eased',
  'comes back by itself once your cadence has held steady for',
  'Press End ERG to leave it off.',
  KEEP_SCREEN_ON_LABEL,
  RIDE_MAY_STOP_WITH_SCREEN_OFF,
  RIDE_NOTIFICATION_REFUSED,
];

/** A controllable trainer this app does not hold, after the link dropped. */
const RIDE_UNCONTROLLED_KEPT_VISIBLE: readonly string[] = [
  'This app does not have control of the trainer.',
  'Control lost',
  LOSS_REASON['link-lost'],
  'Ask the trainer for control first.',
  'A workout sets targets on the trainer, and it will refuse every one until control is granted.',
];

/** Every route in the table, and what on it must stay on the screen. */
const KEPT: Record<RouteId, Kept> = {
  settings: { sentences: SETTINGS_KEPT_VISIBLE },
  camera: {
    sentences: CAMERA_KEPT_VISIBLE.filter(
      (sentence) => !CAMERA_AGREED_KEPT_VISIBLE.includes(sentence),
    ),
    elsewhere: CAMERA_AGREED_KEPT_VISIBLE,
    reason:
      '“Your own computer” and the hosted model (#518) render only once the camera is agreed to, which the walk never does; it is mounted agreed below',
  },
  'side-camera': { sentences: SIDE_CAMERA_KEPT_VISIBLE },
  // The walk hands Files a store holding one ride, so its export panel — and
  // the export's own privacy sentence — is on the page (#699's review, N2).
  transfer: { sentences: FILES_KEPT_VISIBLE },
  devices: {
    sentences: [],
    elsewhere: DEVICES_KEPT_VISIBLE,
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
    sentences: RIDE_KEPT_VISIBLE,
    populated: RIDE_POPULATED_KEPT_VISIBLE,
    elsewhere: [...RIDE_CONTROLLED_KEPT_VISIBLE, ...RIDE_UNCONTROLLED_KEPT_VISIBLE],
    reason:
      'the release, the stall rescue, the recording-service notices and a lost control render only in states the walk does not reach; two mounted cases below cover them',
  },
  game: { sentences: [], reason: NOTHING_TUCKED },
  workouts: { sentences: [], reason: NOTHING_TUCKED },
  activities: { sentences: [], reason: NOTHING_TUCKED },
  analysis: { sentences: [], reason: NOTHING_TUCKED },
  routes: { sentences: [], reason: NOTHING_TUCKED },
  about: { sentences: [], reason: `${NOTHING_TUCKED}: it is the page of prose` },
  credits: { sentences: [], reason: `${NOTHING_TUCKED}: it is the page of prose` },
  // #778: what an instance receives, before sign-in and after; and, once
  // connected (the populated walk), what disconnecting does and does not do.
  instance: { sentences: INSTANCE_KEPT_VISIBLE, populated: INSTANCE_CONNECTED_KEPT_VISIBLE },
  // #955: that every action is logged, and the log outlives an erased account
  // — on the page a moderator acts from (the populated walk; the empty one is
  // an account that moderates nothing, which acts on nothing).
  moderation: {
    sentences: [],
    populated: MODERATION_KEPT_VISIBLE,
    reason: 'the empty walk is an account that moderates nothing, so the page has no action on it',
  },
  'route-builder': { sentences: [], reason: NOTHING_TUCKED },
  'activity-detail': {
    sentences: [],
    // #805, carried from #831's review: what leaves the device, and when, on
    // the ride's page — the ask's explanation and the approved words of what
    // it sends (ADR 0035 D-9 B). The populated fixture sets up the ask.
    // #793: what the "may be raced" box allows, and that sharing is not it.
    populated: [
      WRITE_UP_EXPLANATION,
      `${COMPUTER_SENDS_LEAD} ${COMPUTER_SENDS}`,
      RACE_CONSENT_SENTENCE,
      // #836: the note box's disclosure (ADR 0040 D-11) — where the note goes and
      // that a model reads it.
      ...RIDER_TEXT_KEPT_VISIBLE,
    ],
    reason:
      'the empty walk opens a ride that is not on the device, so nothing of the write-up renders there',
  },
  'segment-detail': { sentences: [], reason: NOTHING_TUCKED },
  'not-found': { sentences: [], reason: NOTHING_TUCKED },
};

/**
 * The six `notes` the shell renders below a view, written out LITERALLY — #993's
 * review. They used to be read from the route table, which let the table
 * classify its own sentences: moving one into `help` (a closed disclosure)
 * went unnoticed. Now the table must still list exactly these as notes, and
 * each is checked drawn and reachable on its route.
 */
const NOTES: Partial<Record<RouteId, readonly string[]>> = {
  ride: ['Everything stays on this device.'],
  routes: [
    'A route is private until you say otherwise, and one that starts inside a privacy zone ' +
      'cannot be shared at all.',
  ],
  camera: ['Pictures and ride details stay on this device unless you turn on sending them below.'],
  settings: ['Nothing here is sent anywhere, and nothing here changes what a ride recorded.'],
  instance: ['Your rides stay on this device.'],
  'side-camera': ['This phone keeps nothing about you afterwards.'],
};

/** A route's list with its literal `notes` added — #993. */
function withNotes(route: RouteDefinition): Kept {
  const kept = KEPT[route.id];
  const notes = (NOTES[route.id] ?? []).filter((note) => !kept.sentences.includes(note));
  return { ...kept, sentences: [...kept.sentences, ...notes] };
}

/** Every sentence a route lists, in every state — what bounds its marks. */
function everyListed(kept: Kept): readonly string[] {
  return [...kept.sentences, ...(kept.populated ?? []), ...(kept.elsewhere ?? [])];
}

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

/**
 * The `aria-hidden` element above `element` (or `element` itself), or
 * `undefined` when assistive technology can reach it — #942. A sentence
 * drawn on the screen and hidden from a screen reader is kept visible to
 * half the riders it is kept for, and an illustration's wrapper is exactly
 * where one could land: art is `aria-hidden` (epic #935, principle 1).
 */
function ariaHiddenAbove(element: Element): Element | undefined {
  return element.closest('[aria-hidden="true"]') ?? undefined;
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
      if (ariaHiddenAbove(element) !== undefined) {
        faults.push(`hidden from assistive technology by aria-hidden: “${sentence}”`);
      }
    }
  }
  for (const marked of root.querySelectorAll('[data-oyl-kept-visible]')) {
    if (closedAbove(marked) !== undefined) {
      faults.push(`marked data-oyl-kept-visible and tucked: “${normalise(marked.textContent)}”`);
    }
    if (ariaHiddenAbove(marked) !== undefined) {
      faults.push(
        `marked data-oyl-kept-visible and under aria-hidden: “${normalise(marked.textContent)}”`,
      );
    }
  }
  return faults;
}

/**
 * Every sentence inside a `data-oyl-kept-visible` element that the route's own
 * lists do not name — #699's review, B1. The browser gate lets a first control
 * sit below the fold behind marked text on the routes it allows, so the mark
 * must not be spendable on ordinary prose: a marked sentence is one somebody
 * listed as safety or privacy text. A sentence is named when it holds a listed
 * fragment, or a listed entry of several sentences holds it.
 *
 * ⚠️ It reads what the walk and the mounted cases RENDER, so a mark on a
 * branch none of them reaches is not checked — Settings' "no map configured"
 * sentence is one such, in a build with no basemap.
 */
function unlistedMarkedSentences(root: Element, listed: readonly string[]): string[] {
  const entries = listed.map(normalise);
  const faults: string[] = [];
  for (const marked of root.querySelectorAll('[data-oyl-kept-visible]')) {
    // A `StatusMessage`'s glyph and label run into its sentence as one block
    // of text; the label is the tone's word, not the sentence that is kept.
    const words = marked.cloneNode(true) as Element;
    for (const label of words.querySelectorAll('.oyl-status__glyph, .oyl-status__label')) {
      label.remove();
    }
    for (const sentence of sentencesIn(words)) {
      if (!entries.some((entry) => sentence.includes(entry) || entry.includes(sentence))) {
        faults.push(`marked data-oyl-kept-visible and in no list: “${sentence}”`);
      }
    }
  }
  return faults;
}

/**
 * A heading inside a `<summary>` anywhere on the page — #699's review, N5.
 * `MoreAbout` has no slot for one, and a `StatusMessage`'s `more.summary` and
 * `SensorPairing`'s summary are two other places one could arrive: a heading
 * inside a summary is exposed differently by different browser and
 * screen-reader pairings (`design/MoreAbout.tsx`).
 */
const HEADING_IN_SUMMARY = 'summary :is(h1, h2, h3, h4, h5, h6, [role="heading"])';

function headingsInSummaries(root: Element): string[] {
  return [...root.querySelectorAll(HEADING_IN_SUMMARY)].map(
    (heading) => `a heading inside a summary: “${normalise(heading.textContent)}”`,
  );
}

/** Every fault the whole rule finds on a page: the list, the mark, and the summary. */
function allFaults(root: Element, kept: readonly string[], listed: readonly string[]): string[] {
  return [
    ...keptVisibleFaults(root, kept),
    ...unlistedMarkedSentences(root, listed),
    ...headingsInSummaries(root),
  ];
}

async function open(route: RouteDefinition, populated: boolean): Promise<Element> {
  const transfer = await emptyTransferPort({ withRide: route.id === 'transfer' });
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
  it('the route table lists exactly the literal notes, and nothing else as one (#993)', () => {
    for (const route of ALL_ROUTES) {
      expect(route.notes ?? [], `${route.id} notes`).toEqual(NOTES[route.id] ?? []);
    }
  });

  for (const data of ['empty', 'populated'] as const) {
    for (const route of ALL_ROUTES) {
      it(`${route.id} (${route.path}), ${data}`, async () => {
        const kept = withNotes(route);
        if (kept.sentences.length === 0) {
          expect(kept.reason, `${route.id} lists nothing and gives no reason`).toBeTruthy();
        }
        const main = await open(route, data === 'populated');
        const sentences = [
          ...kept.sentences,
          ...(data === 'populated' ? (kept.populated ?? []) : []),
        ];
        expect(allFaults(main, sentences, everyListed(kept))).toEqual([]);
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
    expect(allFaults(main, DEVICES_KEPT_VISIBLE, everyListed(KEPT.devices))).toEqual([]);
  });

  it('Camera, agreed to: what is sent to the rider’s own computer stays out of any disclosure', async () => {
    const controller = new CameraController({
      port: scriptedCamera().port,
      schedule: manualSchedule().schedule,
    });
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    mounted = await mount(
      <main>
        <CameraView controller={controller} />
      </main>,
    );
    await settle();
    const main = document.querySelector('main');
    if (main === null) throw new Error('no main');
    expect(allFaults(main, CAMERA_KEPT_VISIBLE, everyListed(KEPT.camera))).toEqual([]);
  });

  it('Ride, a controlled trainer eased by the stall rescue whose release was refused, mid-ride', async () => {
    const riding = ridingSnapshot();
    const stub = stubRideController({
      ...riding,
      keepAliveFailed: true,
      notificationNotice: RIDE_NOTIFICATION_REFUSED,
      trainer: {
        ...riding.trainer,
        releaseFault: 'It may still be holding resistance.',
        ergRescue: {
          target: watts(150),
          holding: 'relief',
          reason:
            'Cadence is falling under the target, so it has been eased to let you spin back up.',
          pending: undefined,
        },
      },
    });
    mounted = await mount(
      <main>
        <RideView controller={stub.controller} />
      </main>,
    );
    await settle();
    const main = document.querySelector('main');
    if (main === null) throw new Error('no main');
    expect(allFaults(main, RIDE_CONTROLLED_KEPT_VISIBLE, everyListed(KEPT.ride))).toEqual([]);
  });

  it('Ride, a controllable trainer this app lost control of', async () => {
    const riding = ridingSnapshot();
    const stub = stubRideController({
      ...idleSnapshot(),
      trainer: {
        ...riding.trainer,
        hasControl: false,
        target: { kind: 'none' },
        lost: 'link-lost',
      },
    });
    mounted = await mount(
      <main>
        <RideView controller={stub.controller} />
      </main>,
    );
    await settle();
    const main = document.querySelector('main');
    if (main === null) throw new Error('no main');
    expect(allFaults(main, RIDE_UNCONTROLLED_KEPT_VISIBLE, everyListed(KEPT.ride))).toEqual([]);
  });

  it('Camera: the side camera’s way in comes before “What this does” — the reorder, guarded by itself', async () => {
    // #666 put the way in first so the screen's first control is above the
    // fold on a phone; the browser gate only saw that by accident (#699's
    // review, B1), because the section's own sentence is ordinary prose.
    const main = await open(routeById('camera'), false);
    const way = main.querySelector('#oyl-camera-side-way');
    const what = main.querySelector('#oyl-camera-what');
    if (way === null || what === null) {
      throw new Error('the Camera screen rendered no side camera way in, or no “What this does”');
    }
    expect(way.compareDocumentPosition(what) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(
      way.closest('section')?.querySelector('a.oyl-button[href="#/camera/side"]'),
    ).not.toBeNull();
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
  it('the rule itself: a kept-visible sentence inside an illustration’s wrapper is reported (#942)', async () => {
    // The fixture #942 names: a card's picture and its kept sentence under one
    // `aria-hidden` wrapper — drawn, and silent to a screen reader.
    mounted = await mount(
      <main>
        <div aria-hidden="true" className="oyl-illustration">
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
            <path d="M0 0 L24 24 Z" />
          </svg>
          <p data-oyl-kept-visible="">A sentence that must stay visible.</p>
        </div>
        <p>A visible sentence.</p>
      </main>,
    );
    const main = document.querySelector('main');
    if (main === null) throw new Error('no main');
    expect(keptVisibleFaults(main, ['A visible sentence.'])).toEqual([
      'marked data-oyl-kept-visible and under aria-hidden: “A sentence that must stay visible.”',
    ]);
    expect(keptVisibleFaults(main, ['A sentence that must stay visible.'])).toEqual([
      'hidden from assistive technology by aria-hidden: “A sentence that must stay visible.”',
      'marked data-oyl-kept-visible and under aria-hidden: “A sentence that must stay visible.”',
    ]);
  });

  it('the rule itself: a marked sentence no list names, and a heading in a summary, are reported', async () => {
    mounted = await mount(
      <main>
        <div data-oyl-kept-visible="">
          <p>A listed sentence. An ordinary one somebody marked.</p>
        </div>
        <details>
          <summary>
            <h3>More about it</h3>
          </summary>
          <p>Tucked.</p>
        </details>
        <details>
          <summary>
            <span role="heading" aria-level={3}>
              And again
            </span>
          </summary>
        </details>
      </main>,
    );
    const main = document.querySelector('main');
    if (main === null) throw new Error('no main');
    expect(unlistedMarkedSentences(main, ['A listed sentence.'])).toEqual([
      'marked data-oyl-kept-visible and in no list: “An ordinary one somebody marked.”',
    ]);
    expect(
      unlistedMarkedSentences(main, ['A listed sentence.', 'An ordinary one somebody marked.']),
    ).toEqual([]);
    // A listed entry of several sentences names each of them.
    expect(
      unlistedMarkedSentences(main, ['A listed sentence. An ordinary one somebody marked.']),
    ).toEqual([]);
    expect(headingsInSummaries(main)).toEqual([
      'a heading inside a summary: “More about it”',
      'a heading inside a summary: “And again”',
    ]);
  });
});
