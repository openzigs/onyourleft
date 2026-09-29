// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A model's write-up on a ride's page** — #805.
 *
 * Rendered inside the real detail view, over the stub store and a scripted
 * {@link RideAnalysisPort}. ⚠️ **The pairs that matter most are the ones a
 * rider could confuse** — `views/CreditsView.test.tsx`'s precedent: nothing
 * asked against written, withheld against failed, and a new write-up against
 * the earlier one left standing after a failure. Each is held apart by the
 * WORDS each renders, never by a class or a colour.
 */

import { unixSeconds } from '@onyourleft/domain';
import { activityId, athleteId, type RideWriteUpRecord } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  AskOutcome,
  RideAnalysisPort,
  RideWriteUpSource,
} from '../ride-analysis/ride-analysis-port';
import { ASK_LABEL, WRITE_UP_HEADING, WRITE_UP_SAVED } from '../ride-analysis/RideWriteUpControl';
import { SIDE_CAMERA_HEADING } from './SideCameraSection';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';
import { ActivityDetailView } from '../views/ActivityDetailView';

import { stubActivity, stubDetail, type StubRide } from './testing';
import {
  WRITE_UP_EARLIER,
  WRITE_UP_FRAMING_LEAD,
  WRITE_UP_FRAMING_REST,
  WRITE_UP_NOT_ASKED,
  WRITE_UP_POSE_TEXT,
  WRITE_UP_SET_UP_BEFORE,
  WRITE_UP_SET_UP_LINK,
  WRITE_UP_SOURCE_TEXT,
  WRITE_UP_UNREADABLE,
  WRITE_UP_WITHHELD_SAVED,
} from './write-up';

const ATHLETE = athleteId('athlete-a');
const RIDE = activityId('ride-1');

function writeUp(text: string, overrides: Partial<RideWriteUpRecord> = {}): RideWriteUpRecord {
  return {
    activityId: RIDE,
    athleteId: ATHLETE,
    text,
    templateId: 'ride-write-up',
    templateVersion: '1',
    source: 'computer',
    includedPose: false,
    missingSections: [],
    writtenAt: unixSeconds(1_800_000_000),
    ...overrides,
  };
}

interface Ask {
  readonly source: RideWriteUpSource;
  settle(outcome: AskOutcome): void;
}

function scriptedPort(sources: readonly RideWriteUpSource[]): RideAnalysisPort & {
  readonly asks: Ask[];
} {
  const asks: Ask[] = [];
  return {
    asks,
    availableSources: () => sources,
    previewHostedRequest: async () => Promise.resolve({ kind: 'shown', steps: [], total: 1 }),
    hostedPreviewSeen: () => true,
    askForRideWriteUp: async (_id, source) =>
      new Promise<AskOutcome>((resolve) => {
        asks.push({ source, settle: resolve });
      }),
  };
}

/** A ride whose saved write-up a test can change, as a store's row changes. */
type MutableRide = { -readonly [K in keyof StubRide]: StubRide[K] };

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function open(
  ride: Partial<MutableRide>,
  port: RideAnalysisPort | undefined,
): Promise<MutableRide> {
  const held: MutableRide = { activity: stubActivity(), channels: {}, laps: [], ...ride };
  document.documentElement.lang = 'en';
  mounted = await mount(
    <main>
      <h1>Ride details</h1>
      <ActivityDetailView port={stubDetail(ATHLETE, held)} activityId={RIDE} writeUp={port} />
    </main>,
  );
  await settle();
  await settle();
  return held;
}

function section(): HTMLElement | null {
  return document.querySelector('section[aria-labelledby="oyl-write-up-heading"]');
}

function text(): string {
  return (section()?.textContent ?? '').replace(/\s+/g, ' ');
}

function quote(): HTMLElement | null {
  return document.querySelector('.oyl-write-up__text');
}

function liveRegion(): string {
  return section()?.querySelector('[role="status"]')?.textContent ?? '';
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  );
  if (found === undefined) {
    throw new Error(`no button "${label}"`);
  }
  return found;
}

/** Whether `first` comes before `second` in the document. */
function before(first: Node, second: Node): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe('text, and only text', () => {
  const HOSTILE =
    '<b>bold</b> **strong** [a link](https://example.com) javascript:alert(1) https://example.com/x\nA second line.';

  it('shows markup, markdown, a javascript: string and a URL as literal characters', async () => {
    await open({ writeUp: writeUp(HOSTILE) }, scriptedPort(['computer']));
    const shown = quote();
    expect(shown?.textContent).toBe(HOSTILE);
    // No element of any kind was made from it: one text node, and no link.
    expect(shown?.childElementCount).toBe(0);
    expect(shown?.childNodes).toHaveLength(1);
    expect(section()?.querySelectorAll('b')).toHaveLength(0);
    // With a model set up the section holds no link of its own at all, so
    // any link in it would be one made from the text.
    expect(section()?.querySelectorAll('a')).toHaveLength(0);
  });

  it('frames it with ADR 0035 D-9 A, above the text', async () => {
    await open({ writeUp: writeUp('A steady ride.') }, scriptedPort(['computer']));
    const framing = [...(section()?.querySelectorAll('p') ?? [])].find((paragraph) =>
      paragraph.textContent.startsWith(WRITE_UP_FRAMING_LEAD),
    );
    expect(framing?.textContent).toBe(`${WRITE_UP_FRAMING_LEAD} ${WRITE_UP_FRAMING_REST}`);
    expect(before(framing as Node, quote() as Node)).toBe(true);
  });

  it('says where it was asked, whether the pose summary went, and which sections are missing', async () => {
    await open(
      {
        writeUp: writeUp('A steady ride.', {
          source: 'hosted',
          includedPose: true,
          missingSections: [1, 3],
        }),
      },
      scriptedPort(['computer']),
    );
    expect(text()).toContain(WRITE_UP_SOURCE_TEXT.hosted);
    expect(text()).toContain(WRITE_UP_POSE_TEXT.included);
    expect(text()).toContain(
      'Sections 2 and 4 could not be analysed, so the write-up says nothing about them.',
    );
    mounted?.unmount();
    await open({ writeUp: writeUp('A steady ride.') }, scriptedPort(['computer']));
    expect(text()).toContain(WRITE_UP_SOURCE_TEXT.computer);
    expect(text()).toContain(WRITE_UP_POSE_TEXT['left-out']);
    expect(text()).not.toContain('could not be analysed');
  });
});

describe('screened before shown, even from the store', () => {
  it('withholds a saved row the screen would not pass, and shows none of its words', async () => {
    const edited = 'Your knee opened to 142° at the bottom. A lovely ride.';
    await open({ writeUp: writeUp(edited) }, scriptedPort(['computer']));
    expect(text()).toContain(WRITE_UP_WITHHELD_SAVED);
    expect(quote()).toBeNull();
    expect(document.body.textContent).not.toContain('A lovely ride');
    expect(document.body.textContent).not.toContain(WRITE_UP_FRAMING_LEAD);
  });

  it('says so, in words, when the row will not decode', async () => {
    await open({ writeUp: 'unreadable' }, scriptedPort(['computer']));
    expect(text()).toContain(WRITE_UP_UNREADABLE);
    expect(quote()).toBeNull();
  });
});

describe('the pairs that must not look alike', () => {
  it('nothing asked, against written', async () => {
    await open({}, scriptedPort(['computer']));
    const nothing = text();
    expect(nothing).toContain(WRITE_UP_NOT_ASKED);
    expect(nothing).not.toContain(WRITE_UP_FRAMING_LEAD);
    mounted?.unmount();
    await open({ writeUp: writeUp('A steady ride.') }, scriptedPort(['computer']));
    const written = text();
    expect(written).toContain(WRITE_UP_FRAMING_LEAD);
    expect(written).toContain('A steady ride.');
    expect(written).not.toContain(WRITE_UP_NOT_ASKED);
  });

  it('withheld, against failed', async () => {
    const withheldText = 'Withheld: the model’s write-up did not pass this app’s checks.';
    const failedText = 'Failed: the model took too long.';
    const port = scriptedPort(['computer']);
    await open({}, port);
    await activateWithKeyboard(button(ASK_LABEL.computer.first));
    port.asks[0]?.settle({ kind: 'failed', text: withheldText });
    await settle();
    const withheld = text();
    mounted?.unmount();
    const again = scriptedPort(['computer']);
    await open({}, again);
    await activateWithKeyboard(button(ASK_LABEL.computer.first));
    again.asks[0]?.settle({ kind: 'failed', text: failedText });
    await settle();
    const failed = text();
    expect(withheld).toContain(withheldText);
    expect(failed).toContain(failedText);
    expect(withheld).not.toBe(failed);
    // And a SAVED row withheld by the screen says a third thing again.
    mounted?.unmount();
    await open({ writeUp: writeUp('At 142° the knee.') }, scriptedPort(['computer']));
    expect(text()).toContain(WRITE_UP_WITHHELD_SAVED);
    expect(text()).not.toContain(withheldText);
    expect(text()).not.toContain(failedText);
  });

  it('a new write-up, against the earlier one left standing after a failure', async () => {
    // The owner's ruling of 2026-09-29: a run that fails keeps the saved one,
    // and the reason is shown ABOVE it.
    const port = scriptedPort(['computer']);
    const ride = await open({ writeUp: writeUp('The first write-up.') }, port);
    expect(text()).not.toContain(WRITE_UP_EARLIER);

    await activateWithKeyboard(button(ASK_LABEL.computer.first));
    port.asks[0]?.settle({ kind: 'failed', text: 'The model took too long.' });
    await settle();
    expect(quote()?.textContent).toBe('The first write-up.');
    expect(text()).toContain(WRITE_UP_EARLIER);
    const reason = section()?.querySelector('[role="status"]');
    const earlier = [...(section()?.querySelectorAll('p') ?? [])].find(
      (paragraph) => paragraph.textContent === WRITE_UP_EARLIER,
    );
    expect(reason?.textContent).toBe('The model took too long.');
    expect(before(reason as Node, earlier as Node)).toBe(true);
    expect(before(earlier as Node, quote() as Node)).toBe(true);

    // A run that is written replaces it, and the page reads it back.
    ride.writeUp = writeUp('The second write-up.');
    await activateWithKeyboard(button(ASK_LABEL.computer.first));
    port.asks[1]?.settle({ kind: 'written' });
    await settle();
    await settle();
    expect(liveRegion()).toBe(WRITE_UP_SAVED);
    expect(quote()?.textContent).toBe('The second write-up.');
    expect(text()).not.toContain(WRITE_UP_EARLIER);
    expect(text()).not.toContain('The first write-up.');
  });
});

describe('the fallback: no model set up', () => {
  it.each([
    ['no port', undefined],
    ['no source set up', scriptedPort([])],
  ])('with %s, is one sentence and a link, and asks nothing', async (_what, port) => {
    await open({}, port);
    expect(section()).toBeNull();
    expect(document.body.textContent).not.toContain(WRITE_UP_HEADING);
    const link = [...document.querySelectorAll('a')].find(
      (candidate) => candidate.textContent === WRITE_UP_SET_UP_LINK,
    );
    expect(link?.getAttribute('href')).toBe('#/camera');
    expect(link?.parentElement?.textContent).toContain(WRITE_UP_SET_UP_BEFORE);
    expect(document.querySelectorAll('button')).toHaveLength(0);
    expect(port?.asks ?? []).toHaveLength(0);
  });

  it('still shows a saved write-up, with the same sentence in place of the control', async () => {
    await open({ writeUp: writeUp('A steady ride.') }, scriptedPort([]));
    expect(text()).toContain(WRITE_UP_SET_UP_BEFORE);
    expect(quote()?.textContent).toBe('A steady ride.');
    expect(document.querySelectorAll('button')).toHaveLength(0);
  });

  it('sits below the side camera’s report, never in place of it', async () => {
    await open(
      {
        writeUp: writeUp('A steady ride.'),
        sideCamera: 'unreadable',
      },
      scriptedPort(['computer']),
    );
    const camera = [...document.querySelectorAll('h3')].find(
      (heading) => heading.textContent === SIDE_CAMERA_HEADING,
    );
    expect(camera).toBeDefined();
    expect(before(camera as Node, section() as Node)).toBe(true);
  });
});
