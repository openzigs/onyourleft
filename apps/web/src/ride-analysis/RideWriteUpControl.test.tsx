// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The press on a ride's page (#804), rendered inside the real detail view
 * over a scripted {@link RideAnalysisPort}: which controls are offered, that
 * opening the page sends nothing, what the live region says while a run goes
 * and after it ends, and that Cancel and leaving the page both stop it.
 */

import { activityId, athleteId, type ActivityId } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { HOSTED_CONSENT, HOSTED_MASKING_NOTICE } from '../camera/hosted-model';
import { HOSTED_SENDS } from '../detail/write-up';
import { stubActivity, stubDetail } from '../detail/testing';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';
import { ActivityDetailView } from '../views/ActivityDetailView';
import type {
  AskOutcome,
  AskProgress,
  RideAnalysisPort,
  RideWriteUpSource,
  HostedPreview,
} from './ride-analysis-port';
import {
  ASK_LABEL,
  CANCEL_LABEL,
  PREVIEW_CLOSE_LABEL,
  PREVIEW_INTRO,
  PREVIEW_LABEL,
  PREVIEW_LATER,
  PREVIEW_SEND_LABEL,
  previewStepLabel,
  progressText,
  WRITE_UP_HEADING,
  WRITE_UP_SAVED,
} from './RideWriteUpControl';

const ATHLETE = athleteId('athlete-a');
const RIDE = activityId('ride-1');

interface Ask {
  readonly activityId: ActivityId;
  readonly source: RideWriteUpSource;
  readonly signal: AbortSignal;
  readonly progress: ((progress: AskProgress) => void) | undefined;
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
    askForRideWriteUp: async (id, source, signal, progress) =>
      new Promise<AskOutcome>((resolve) => {
        asks.push({ activityId: id, source, signal, progress, settle: resolve });
      }),
  };
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function open(port: RideAnalysisPort | undefined): Promise<void> {
  document.documentElement.lang = 'en';
  mounted = await mount(
    <main>
      <h1>Ride details</h1>
      <ActivityDetailView
        port={stubDetail(ATHLETE, { activity: stubActivity(), channels: {}, laps: [] })}
        activityId={RIDE}
        writeUp={port}
      />
    </main>,
  );
  await settle();
  await settle();
}

function buttons(): string[] {
  return [...document.querySelectorAll('section[aria-labelledby] button')].map(
    (button) => button.textContent,
  );
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

function liveRegion(): string {
  return document.querySelector('[role="status"][aria-live="polite"]')?.textContent ?? '';
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`).toBe('');
}

describe('which controls are offered', () => {
  it('offers no control without a port, or with no source set up', async () => {
    await open(undefined);
    expect(document.body.textContent).not.toContain(WRITE_UP_HEADING);
    mounted?.unmount();
    await open(scriptedPort([]));
    expect(document.body.textContent).not.toContain(WRITE_UP_HEADING);
  });

  it('offers the rider’s own computer first and the hosted model as the alternative', async () => {
    await open(scriptedPort(['computer', 'hosted']));
    expect(buttons()).toStrictEqual([
      ASK_LABEL.computer.first,
      ASK_LABEL.hosted.other,
      PREVIEW_LABEL,
    ]);
    expectClean('both sources offered');
  });

  it('offers the one source that is set up, alone', async () => {
    await open(scriptedPort(['hosted']));
    expect(buttons()).toStrictEqual([ASK_LABEL.hosted.first, PREVIEW_LABEL]);
  });
});

describe('what the hosted ask says it sends (#803, carried from #838’s review)', () => {
  /** The paragraphs of the "what is sent" block every ask control is described by. */
  function sendsParagraphs(): string[] {
    const control = document.querySelector('.oyl-write-up__controls button');
    const id = control?.getAttribute('aria-describedby') ?? '';
    return [...(document.getElementById(id)?.querySelectorAll('p') ?? [])].map(
      (paragraph) => paragraph.textContent,
    );
  }

  it('stands ADR 0035 D-9 C beside the hosted ask in full, but for the sentence about the switch', async () => {
    await open(scriptedPort(['hosted']));
    // `write-up.test.ts` pins HOSTED_SENDS to the ADR; this pins what renders to it.
    expect(sendsParagraphs()).toStrictEqual([...HOSTED_SENDS, HOSTED_MASKING_NOTICE]);
    expect(sendsParagraphs().join(' ')).toContain('your heart rate, cadence and power');
    expect(document.body.textContent).not.toContain(HOSTED_CONSENT.offUntilOn);
    expectClean('the hosted wording');
  });

  it('says both, in order, when both sources are offered', async () => {
    await open(scriptedPort(['computer', 'hosted']));
    const said = sendsParagraphs();
    expect(said).toHaveLength(2 + HOSTED_SENDS.length);
    expect(said.slice(1)).toStrictEqual([...HOSTED_SENDS, HOSTED_MASKING_NOTICE]);
  });

  it('says none of it where only the rider’s computer is offered', async () => {
    await open(scriptedPort(['computer']));
    expect(document.body.textContent).not.toContain(HOSTED_CONSENT.headline);
    expect(document.body.textContent).not.toContain(HOSTED_MASKING_NOTICE);
  });
});

describe('a press, and only a press', () => {
  it('asks nothing when the page opens', async () => {
    const port = scriptedPort(['computer']);
    await open(port);
    expect(port.asks).toHaveLength(0);
  });

  it('asks the chosen source about this ride, says the steps and then that it was saved', async () => {
    const port = scriptedPort(['computer', 'hosted']);
    await open(port);
    await activateWithKeyboard(button(ASK_LABEL.hosted.other));
    expect(port.asks).toHaveLength(1);
    const [asked] = port.asks;
    expect(asked?.activityId).toBe(RIDE);
    expect(asked?.source).toBe('hosted');
    // While it runs (#805): the ask controls stay in the tab order, marked
    // aria-disabled, beside Cancel — and a press on one asks nothing more.
    expect(buttons()).toStrictEqual([
      ASK_LABEL.computer.first,
      ASK_LABEL.hosted.other,
      PREVIEW_LABEL,
      CANCEL_LABEL,
    ]);
    for (const label of [ASK_LABEL.computer.first, ASK_LABEL.hosted.other]) {
      expect(button(label).getAttribute('aria-disabled')).toBe('true');
      expect(button(label).disabled).toBe(false);
    }
    expect(button(CANCEL_LABEL).hasAttribute('aria-disabled')).toBe(false);
    await activateWithKeyboard(button(ASK_LABEL.computer.first));
    expect(port.asks).toHaveLength(1);
    expectClean('a write-up running');
    asked?.progress?.({ step: 2, total: 5 });
    await settle();
    expect(liveRegion()).toBe(progressText(2, 5));
    expect(liveRegion()).toBe('Step 2 of 5.');
    asked?.settle({ kind: 'written' });
    await settle();
    expect(liveRegion()).toBe(WRITE_UP_SAVED);
    expect(buttons()).toStrictEqual([
      ASK_LABEL.computer.first,
      ASK_LABEL.hosted.other,
      PREVIEW_LABEL,
    ]);
    expect(button(ASK_LABEL.computer.first).hasAttribute('aria-disabled')).toBe(false);
    expectClean('a write-up saved');
  });

  it('says a failure in the sentence it was handed', async () => {
    const port = scriptedPort(['computer']);
    await open(port);
    await activateWithKeyboard(button(ASK_LABEL.computer.first));
    port.asks[0]?.settle({ kind: 'failed', text: 'A fixed sentence from the table.' });
    await settle();
    expect(liveRegion()).toBe('A fixed sentence from the table.');
  });
});

describe('stopping a run', () => {
  it('Cancel aborts the run’s signal', async () => {
    const port = scriptedPort(['computer']);
    await open(port);
    await activateWithKeyboard(button(ASK_LABEL.computer.first));
    expect(port.asks[0]?.signal.aborted).toBe(false);
    await activateWithKeyboard(button(CANCEL_LABEL));
    expect(port.asks[0]?.signal.aborted).toBe(true);
  });

  it('leaving the page aborts it too', async () => {
    const port = scriptedPort(['computer']);
    await open(port);
    await activateWithKeyboard(button(ASK_LABEL.computer.first));
    mounted?.unmount();
    mounted = undefined;
    expect(port.asks[0]?.signal.aborted).toBe(true);
  });

  it('ignores progress from a run it has left', async () => {
    const port = scriptedPort(['computer']);
    await open(port);
    await activateWithKeyboard(button(ASK_LABEL.computer.first));
    const first = port.asks[0];
    first?.settle({ kind: 'failed', text: 'Stopped.' });
    await settle();
    first?.progress?.({ step: 1, total: 3 });
    await settle();
    expect(liveRegion()).toBe('Stopped.');
  });
});

describe('the preview of what a hosted run sends (#839)', () => {
  const SHOWN: HostedPreview = {
    kind: 'shown',
    steps: [
      { step: 1, system: 'Instructions one.', user: 'Section one near [place].' },
      { step: 2, system: 'Instructions two.', user: 'Section two.' },
    ],
    total: 3,
  };

  function previewingPort(
    seen: boolean,
    shown: HostedPreview = SHOWN,
  ): ReturnType<typeof scriptedPort> & { readonly previews: number[] } {
    const base = scriptedPort(['computer', 'hosted']);
    const previews: number[] = [];
    let wasSeen = seen;
    return {
      ...base,
      previews,
      hostedPreviewSeen: () => wasSeen,
      previewHostedRequest: async () => {
        previews.push(1);
        wasSeen = true;
        return Promise.resolve(shown);
      },
    };
  }

  function sentTexts(): string[] {
    return [...document.querySelectorAll('[data-oyl-sent]')].map((node) => node.textContent);
  }

  it('shows the preview before the first hosted run, and sends only from it', async () => {
    const port = previewingPort(false);
    await open(port);
    await activateWithKeyboard(button(ASK_LABEL.hosted.other));
    await settle();
    expect(port.asks).toHaveLength(0);
    expect(port.previews).toHaveLength(1);
    expect(document.body.textContent).toContain(PREVIEW_INTRO);
    expect(document.body.textContent).toContain(PREVIEW_LATER);
    expect(sentTexts()).toStrictEqual([
      'Instructions one.',
      'Section one near [place].',
      'Instructions two.',
      'Section two.',
    ]);
    expect(document.body.textContent).toContain(previewStepLabel(2, 3, 'user'));
    expectClean('the preview before a first hosted run');

    await activateWithKeyboard(button(PREVIEW_SEND_LABEL));
    expect(port.asks.map((ask) => ask.source)).toStrictEqual(['hosted']);
    // The preview closes when the run starts.
    expect(sentTexts()).toStrictEqual([]);
  });

  it('goes straight to the run once a preview has been seen', async () => {
    const port = previewingPort(true);
    await open(port);
    await activateWithKeyboard(button(ASK_LABEL.hosted.other));
    expect(port.asks).toHaveLength(1);
    expect(port.previews).toHaveLength(0);
  });

  it('shows the preview at any time from its own control, with nothing to send from it', async () => {
    const port = previewingPort(true);
    await open(port);
    await activateWithKeyboard(button(PREVIEW_LABEL));
    await settle();
    expect(port.previews).toHaveLength(1);
    expect(port.asks).toHaveLength(0);
    expect(sentTexts()).toHaveLength(4);
    expect(() => button(PREVIEW_SEND_LABEL)).toThrow();
    expectClean('the preview opened on its own');
    await activateWithKeyboard(button(PREVIEW_CLOSE_LABEL));
    expect(sentTexts()).toStrictEqual([]);
    expect(buttons()).toContain(PREVIEW_LABEL);
  });

  it('says why when there is nothing to show, and offers nothing to send', async () => {
    const port = previewingPort(false, { kind: 'failed', text: 'Nothing to show.' });
    await open(port);
    await activateWithKeyboard(button(ASK_LABEL.hosted.other));
    await settle();
    expect(document.body.textContent).toContain('Nothing to show.');
    expect(() => button(PREVIEW_SEND_LABEL)).toThrow();
    expect(port.asks).toHaveLength(0);
  });

  it('offers no preview when the hosted model is not a source', async () => {
    await open(previewingPort(false));
    mounted?.unmount();
    await open(scriptedPort(['computer']));
    expect(() => button(PREVIEW_LABEL)).toThrow();
  });
});
