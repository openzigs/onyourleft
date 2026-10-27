// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A model's write-up on a ride's page** — #805, and since #1103 asked of
 * the rider's instance only.
 *
 * Rendered inside the real detail view, over the stub store and a scripted
 * {@link InstanceAnalysisPort}. ⚠️ **The pairs that matter most are the ones a
 * rider could confuse** — `views/CreditsView.test.tsx`'s precedent: nothing
 * asked against written, withheld against failed, and a new write-up against
 * the earlier one left standing after a failure. Each is held apart by the
 * WORDS each renders, never by a class or a colour.
 *
 * A write-up saved by a path #1103 removed — the rider's own computer, or a
 * hosted model on a key kept on the device — still renders, screened, with
 * where it was asked in words: those rows are seeded here as a store holds
 * them, and read back through the page.
 */

import { unixSeconds } from '@onyourleft/domain';
import { activityId, athleteId, type RideWriteUpRecord } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  AskOutcome,
  InstanceAnalysisPort,
  InstanceAskOutcome,
} from '../ride-analysis/instance-analysis-port';
import { INSTANCE_ASK_LABEL } from '../ride-analysis/InstanceWriteUpControl';
import { RideWriteUpSection } from './RideWriteUpSection';
import { SIDE_CAMERA_HEADING } from './SideCameraSection';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';
import { ActivityDetailView } from '../views/ActivityDetailView';
import { INSTANCE_ROUTE } from '../shell/routes';

import type { WriteUpOverview } from './load';
import { stubActivity, stubDetail, type StubRide } from './testing';
import {
  WRITE_UP_CANNOT_ASK_HERE,
  WRITE_UP_EARLIER,
  WRITE_UP_EARLIER_NOT_READ,
  WRITE_UP_EARLIER_READING,
  WRITE_UP_FRAMING_LEAD,
  WRITE_UP_FRAMING_REST,
  WRITE_UP_HEADING,
  WRITE_UP_NO_INSTANCE_BEFORE,
  WRITE_UP_NOT_ASKED,
  WRITE_UP_POSE_TEXT,
  WRITE_UP_REPLACES,
  WRITE_UP_SAVED,
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
    templateId: 'ride-write-up-agent',
    templateVersion: '1',
    source: 'instance-local',
    includedPose: false,
    missingSections: [],
    writtenAt: unixSeconds(1_800_000_000),
    ...overrides,
  };
}

/** An instance this device is signed in to (or not), whose jobs a test ends by hand. */
function scriptedInstance(connected = true): InstanceAnalysisPort & {
  readonly asks: ((outcome: AskOutcome) => void)[];
} {
  const asks: ((outcome: AskOutcome) => void)[] = [];
  return {
    asks,
    connected: () => connected,
    availableSources: () => (connected ? ['instance-local'] : []),
    hostedEndpoint: () => undefined,
    pendingJob: () => false,
    ask: async () =>
      new Promise<InstanceAskOutcome>((resolve) => {
        asks.push(resolve);
      }),
    followAgain: async () => Promise.resolve({ kind: 'detached' }),
    cancel: async () => Promise.resolve(),
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
  instance: InstanceAnalysisPort | undefined,
): Promise<MutableRide> {
  const held: MutableRide = { activity: stubActivity(), channels: {}, laps: [], ...ride };
  document.documentElement.lang = 'en';
  mounted = await mount(
    <main>
      <h1>Ride details</h1>
      <ActivityDetailView
        port={stubDetail(ATHLETE, held)}
        activityId={RIDE}
        instanceWriteUp={instance}
      />
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

const ASK = INSTANCE_ASK_LABEL['instance-local'];

/** Whether `first` comes before `second` in the document. */
function before(first: Node, second: Node): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe('what the section says before a press, layered — #1439', () => {
  it('says what a new write-up does behind the ⓘ, and what is sent once', async () => {
    await open({}, scriptedInstance());
    // The press's mechanics are the explanation, behind the heading's ⓘ.
    const help = section()?.querySelector('.oyl-section-head details.oyl-section-help');
    expect(help?.textContent).toContain(WRITE_UP_REPLACES);
    expect(help?.hasAttribute('open')).toBe(false);
    // "Never a picture" is said by the approved paragraph beside the press,
    // and not a second time above it.
    expect(text().match(/never a picture/gi)).toHaveLength(1);
  });
});

describe('text, and only text', () => {
  const HOSTILE =
    '<b>bold</b> **strong** [a link](https://example.com) javascript:alert(1) https://example.com/x\nA second line.';

  it('shows markup, markdown, a javascript: string and a URL as literal characters', async () => {
    await open({ writeUp: writeUp(HOSTILE) }, scriptedInstance());
    const shown = quote();
    expect(shown?.textContent).toBe(HOSTILE);
    // No element of any kind was made from it: one text node, and no link.
    expect(shown?.childElementCount).toBe(0);
    expect(shown?.childNodes).toHaveLength(1);
    expect(section()?.querySelectorAll('b')).toHaveLength(0);
    // Signed in, the section holds no link of its own at all, so any link in
    // it would be one made from the text.
    expect(section()?.querySelectorAll('a')).toHaveLength(0);
  });

  it('frames it with ADR 0035 D-9 A, above the text', async () => {
    await open({ writeUp: writeUp('A steady ride.') }, scriptedInstance());
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
          source: 'instance-hosted',
          includedPose: true,
          missingSections: [1, 3],
        }),
      },
      scriptedInstance(),
    );
    expect(text()).toContain(WRITE_UP_SOURCE_TEXT['instance-hosted']);
    expect(text()).toContain(WRITE_UP_POSE_TEXT.included);
    expect(text()).toContain(
      'Sections 2 and 4 could not be analysed, so the write-up says nothing about them.',
    );
    mounted?.unmount();
    await open({ writeUp: writeUp('A steady ride.') }, scriptedInstance());
    expect(text()).toContain(WRITE_UP_SOURCE_TEXT['instance-local']);
    expect(text()).toContain(WRITE_UP_POSE_TEXT['left-out']);
    expect(text()).not.toContain('could not be analysed');
  });
});

describe('a write-up saved before #1103 survives it', () => {
  it.each([
    ['the rider’s own computer', 'computer'],
    ['a hosted model on a key kept on the device', 'hosted'],
  ] as const)(
    'one written by %s still renders, screened, with where it was asked',
    async (_what, source) => {
      for (const instance of [scriptedInstance(), scriptedInstance(false), undefined]) {
        await open({ writeUp: writeUp('An earlier ride, written up.', { source }) }, instance);
        expect(quote()?.textContent).toBe('An earlier ride, written up.');
        expect(text()).toContain(WRITE_UP_FRAMING_LEAD);
        expect(text()).toContain(WRITE_UP_SOURCE_TEXT[source]);
        mounted?.unmount();
        mounted = undefined;
      }
    },
  );

  it('and is still screened on display: one the screen would not pass is withheld', async () => {
    await open(
      { writeUp: writeUp('Your knee opened to 142°.', { source: 'computer' }) },
      undefined,
    );
    expect(text()).toContain(WRITE_UP_WITHHELD_SAVED);
    expect(quote()).toBeNull();
  });
});

describe('screened before shown, even from the store', () => {
  it('withholds a saved row the screen would not pass, and shows none of its words', async () => {
    const edited = 'Your knee opened to 142° at the bottom. A lovely ride.';
    await open({ writeUp: writeUp(edited) }, scriptedInstance());
    expect(text()).toContain(WRITE_UP_WITHHELD_SAVED);
    expect(quote()).toBeNull();
    expect(document.body.textContent).not.toContain('A lovely ride');
    expect(document.body.textContent).not.toContain(WRITE_UP_FRAMING_LEAD);
  });

  it('says so, in words, when the row will not decode', async () => {
    await open({ writeUp: 'unreadable' }, scriptedInstance());
    expect(text()).toContain(WRITE_UP_UNREADABLE);
    expect(quote()).toBeNull();
  });
});

describe('the pairs that must not look alike', () => {
  it('nothing asked, against written', async () => {
    await open({}, scriptedInstance());
    const nothing = text();
    expect(nothing).toContain(WRITE_UP_NOT_ASKED);
    expect(nothing).not.toContain(WRITE_UP_FRAMING_LEAD);
    mounted?.unmount();
    await open({ writeUp: writeUp('A steady ride.') }, scriptedInstance());
    const written = text();
    expect(written).toContain(WRITE_UP_FRAMING_LEAD);
    expect(written).toContain('A steady ride.');
    expect(written).not.toContain(WRITE_UP_NOT_ASKED);
  });

  it('withheld, against failed', async () => {
    const withheldText = 'Withheld: the model’s write-up did not pass this app’s checks.';
    const failedText = 'Failed: the model took too long.';
    const port = scriptedInstance();
    await open({}, port);
    await activateWithKeyboard(button(ASK));
    port.asks[0]?.({ kind: 'failed', text: withheldText });
    await settle();
    const withheld = text();
    mounted?.unmount();
    const again = scriptedInstance();
    await open({}, again);
    await activateWithKeyboard(button(ASK));
    again.asks[0]?.({ kind: 'failed', text: failedText });
    await settle();
    const failed = text();
    expect(withheld).toContain(withheldText);
    expect(failed).toContain(failedText);
    expect(withheld).not.toBe(failed);
    // And a SAVED row withheld by the screen says a third thing again.
    mounted?.unmount();
    await open({ writeUp: writeUp('At 142° the knee.') }, scriptedInstance());
    expect(text()).toContain(WRITE_UP_WITHHELD_SAVED);
    expect(text()).not.toContain(withheldText);
    expect(text()).not.toContain(failedText);
  });

  it('a new write-up, against the earlier one left standing after a failure', async () => {
    // The owner's ruling of 2026-09-29: a run that fails keeps the saved one,
    // and the reason is shown ABOVE it.
    const port = scriptedInstance();
    const ride = await open({ writeUp: writeUp('The first write-up.') }, port);
    expect(text()).not.toContain(WRITE_UP_EARLIER);

    await activateWithKeyboard(button(ASK));
    port.asks[0]?.({ kind: 'failed', text: 'The model took too long.' });
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
    await activateWithKeyboard(button(ASK));
    port.asks[1]?.({ kind: 'written' });
    await settle();
    await settle();
    expect(liveRegion()).toBe(WRITE_UP_SAVED);
    expect(quote()?.textContent).toBe('The second write-up.');
    expect(text()).not.toContain(WRITE_UP_EARLIER);
    expect(text()).not.toContain('The first write-up.');
  });
});

describe('between a write-up being saved and it being read back — #816', () => {
  /** The section alone, with a read-back the test settles by hand. */
  async function openSection(port: InstanceAnalysisPort): Promise<{
    resolve(overview: WriteUpOverview): void;
    reject(error: unknown): void;
  }> {
    let resolve: (overview: WriteUpOverview) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    mounted = await mount(
      <main>
        <h1>Ride details</h1>
        <RideWriteUpSection
          instance={port}
          activityId={RIDE}
          initial={{ kind: 'saved', record: writeUp('The first write-up.') }}
          reread={async () =>
            new Promise<WriteUpOverview>((onResolve, onReject) => {
              resolve = onResolve;
              reject = onReject;
            })
          }
        />
      </main>,
    );
    await settle();
    return {
      resolve: (overview) => {
        resolve(overview);
      },
      reject: (error) => {
        reject(error);
      },
    };
  }

  it('says the write-up still shown is the earlier one until the new one is read back', async () => {
    const port = scriptedInstance();
    const readBack = await openSection(port);
    await activateWithKeyboard(button(ASK));
    port.asks[0]?.({ kind: 'written' });
    await settle();
    expect(liveRegion()).toBe(WRITE_UP_SAVED);
    expect(quote()?.textContent).toBe('The first write-up.');
    expect(text()).toContain(WRITE_UP_EARLIER_READING);
    // Not the failure's sentence: nothing failed.
    expect(text()).not.toContain(WRITE_UP_EARLIER);

    readBack.resolve({ kind: 'saved', record: writeUp('The second write-up.') });
    await settle();
    expect(quote()?.textContent).toBe('The second write-up.');
    expect(text()).not.toContain(WRITE_UP_EARLIER_READING);
  });

  it('catches a read-back that fails, and still does not pass the old write-up off as the new one', async () => {
    const port = scriptedInstance();
    const readBack = await openSection(port);
    await activateWithKeyboard(button(ASK));
    port.asks[0]?.({ kind: 'written' });
    await settle();
    // Vitest fails the run on an unhandled rejection, so this also holds the catch.
    readBack.reject(new Error('the store went away'));
    await settle();
    expect(quote()?.textContent).toBe('The first write-up.');
    expect(text()).toContain(WRITE_UP_EARLIER_NOT_READ);
    expect(text()).not.toContain(WRITE_UP_EARLIER_READING);
  });
});

describe('with nothing to ask', () => {
  it('in a browser that cannot hold an instance sign-in, is one sentence, with no link, and asks nothing (#1103)', async () => {
    await open({}, undefined);
    expect(section()).toBeNull();
    expect(document.body.textContent).not.toContain(WRITE_UP_HEADING);
    const sentence = [...document.querySelectorAll('p')].find(
      (paragraph) => paragraph.textContent === WRITE_UP_CANNOT_ASK_HERE,
    );
    expect(sentence).toBeDefined();
    // No link: the Connect screen cannot help in this browser. And no
    // "Camera page" link, which pointed at a set-up #1103 removed.
    expect(sentence?.querySelector('a')).toBeNull();
    expect(document.querySelector('a[href="#/camera"]')).toBeNull();
    expect(document.querySelectorAll('button')).toHaveLength(0);
  });

  it('signed in to no instance, is one sentence and a link to connect one, and asks nothing', async () => {
    const port = scriptedInstance(false);
    await open({}, port);
    expect(section()).toBeNull();
    const link = [...document.querySelectorAll('a')].find(
      (candidate) => candidate.textContent === INSTANCE_ROUTE.title,
    );
    expect(link?.getAttribute('href')).toBe(`#${INSTANCE_ROUTE.path}`);
    expect(link?.parentElement?.textContent).toContain(WRITE_UP_NO_INSTANCE_BEFORE);
    expect(document.querySelectorAll('button')).toHaveLength(0);
    expect(port.asks).toHaveLength(0);
  });

  it('still shows a saved write-up, with the same sentence in place of the control', async () => {
    await open({ writeUp: writeUp('A steady ride.') }, undefined);
    expect(text()).toContain(WRITE_UP_CANNOT_ASK_HERE);
    expect(quote()?.textContent).toBe('A steady ride.');
    expect(document.querySelectorAll('button')).toHaveLength(0);
  });

  it('sits below the side camera’s report, never in place of it', async () => {
    await open(
      {
        writeUp: writeUp('A steady ride.'),
        sideCamera: 'unreadable',
      },
      scriptedInstance(),
    );
    const camera = [...document.querySelectorAll('h3')].find(
      (heading) => heading.textContent === SIDE_CAMERA_HEADING,
    );
    expect(camera).toBeDefined();
    expect(before(camera as Node, section() as Node)).toBe(true);
  });
});
