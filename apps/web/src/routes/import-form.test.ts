// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Reading the routes screen's import form — #296.
 *
 * ⚠️ **This is where the loop box is proved to reach the profile**, and it is
 * here rather than in `RoutesView.test.tsx` for one reason: jsdom cannot put a
 * file into a `<input type="file">` at all, and `testing/mount.tsx` says so at
 * length where the missing helper would be. A `FormData` built by hand carries
 * a real `File`, so every step from "what the form said" to "what the record
 * holds" runs here; the rendered form contributes its field *names*, which
 * `RoutesView.test.tsx` builds a `FormData` from the real DOM to pin.
 */

import { unixSeconds } from '@onyourleft/domain';
import { athleteId, routeId } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { FILE_NOT_READABLE, LOOP_FIELD, routeFromImportForm } from './import-form';
import { loopGpx, openEndedGpx } from './testing';
import type { SaveOutcome } from './save';

const ATHLETE = athleteId('athlete-a');
const NOW = unixSeconds(1_700_000_000);

/** The form as it arrives from a submit: a chosen file, and a box or no box. */
function submitted(
  text: string,
  options: { readonly loop?: boolean; readonly name?: string } = {},
) {
  const form = new FormData();
  form.set('file', new File([text], options.name ?? 'sunday.gpx'));
  if (options.loop === true) {
    // The value a browser sends for a ticked checkbox with no `value` of its
    // own. The reader must not depend on it — see `loopChosen`.
    form.set(LOOP_FIELD, 'on');
  }
  return form;
}

async function importing(
  text: string,
  options: { readonly loop?: boolean; readonly name?: string } = {},
): Promise<SaveOutcome> {
  return routeFromImportForm(submitted(text, options), {
    id: routeId('route-1'),
    owner: ATHLETE,
    now: NOW,
  });
}

describe('the loop box', () => {
  it('saves a circuit as a loop, which is what makes lapping reachable at all', async () => {
    const outcome = await importing(loopGpx(), { loop: true });

    expect(outcome.status).toBe('saved');
    if (outcome.status !== 'saved') return;
    expect(outcome.record.profile.loop).toBe(true);
  });

  it('leaves the same file point to point when the box is not ticked', async () => {
    // The other half of the assertion above: a test that only checked the
    // ticked case would pass against a screen that marked every import a loop.
    const outcome = await importing(loopGpx());

    expect(outcome.status).toBe('saved');
    if (outcome.status !== 'saved') return;
    expect(outcome.record.profile.loop).toBe(false);
  });

  it('reads any value the browser sends, not the word “on”', async () => {
    // A checkbox with a `value` attribute sends that instead, and a reader
    // comparing against 'on' would silently drop the rider's answer.
    const form = new FormData();
    form.set('file', new File([loopGpx()], 'sunday.gpx'));
    form.set(LOOP_FIELD, 'yes-please');

    const outcome = await routeFromImportForm(form, {
      id: routeId('route-1'),
      owner: ATHLETE,
      now: NOW,
    });

    expect(outcome.status).toBe('saved');
    if (outcome.status !== 'saved') return;
    expect(outcome.record.profile.loop).toBe(true);
  });
});

describe('a file that is not a loop, imported as one', () => {
  it('is refused with the gap in metres, and nothing is handed back to save', async () => {
    const outcome = await importing(openEndedGpx(340), { loop: true, name: 'ridgeway.gpx' });

    expect(outcome.status).toBe('refused');
    if (outcome.status !== 'refused') return;
    // Its own code, so the screen is not telling a rider that a perfectly good
    // route file is not a route.
    expect(outcome.refusal.code).toBe('not-a-loop');
    // The gap is the diagnostic and it is a distance, so it is in the message —
    // ADR 0004 decision D is about where the two ends *are*, which is not.
    expect(outcome.refusal.message).toContain('340 m apart');
    expect(outcome.refusal.message).toContain('25 m');
    // And what to do about it, which is the half a validation failure omits.
    expect(outcome.refusal.message).toContain('ridgeway.gpx');
    expect(outcome.refusal.message.toLowerCase()).toContain('without');
  });

  it('never quietly falls back to saving it as a point-to-point route', async () => {
    // #296's second criterion in its literal form. A screen that caught the
    // refusal and retried without the flag would save a route the rider never
    // asked for, under a name suggesting they got what they wanted.
    const outcome = await importing(openEndedGpx(340), { loop: true });

    expect(outcome.status).not.toBe('saved');
  });
});

describe('the file itself', () => {
  it('asks for one rather than reporting bad GPX when none was chosen', async () => {
    // ⚠️ The guard is NOT `instanceof File`: a file input with no selection
    // still appends an entry holding a `File` with an empty name and no body,
    // so the obvious check passes and the empty body reaches the decoder.
    const form = new FormData();
    form.set('file', new File([], ''));

    const outcome = await routeFromImportForm(form, {
      id: routeId('route-1'),
      owner: ATHLETE,
      now: NOW,
    });

    expect(outcome.status).toBe('refused');
    if (outcome.status !== 'refused') return;
    expect(outcome.refusal.message).toBe('Choose a GPX file to import.');
  });

  it('asks for one when the field is not a file at all', async () => {
    const form = new FormData();
    form.set('file', 'sunday.gpx');

    const outcome = await routeFromImportForm(form, {
      id: routeId('route-1'),
      owner: ATHLETE,
      now: NOW,
    });

    expect(outcome.status).toBe('refused');
    if (outcome.status !== 'refused') return;
    expect(outcome.refusal.message).toBe('Choose a GPX file to import.');
  });

  it('says so when the chosen file cannot be read off the disk any more', async () => {
    // A `File` is a handle onto something on disk, and a browser rejects the
    // read when it has moved or changed since the picker handed it over.
    // Unhandled, that is a rejected promise inside a click handler: the screen
    // does nothing at all and the rider presses the button again.
    const file = new File([loopGpx()], 'sunday.gpx');
    Object.defineProperty(file, 'text', {
      value: () => Promise.reject(new DOMException('NotReadableError')),
    });
    const form = new FormData();
    form.set('file', file);

    const outcome = await routeFromImportForm(form, {
      id: routeId('route-1'),
      owner: ATHLETE,
      now: NOW,
    });

    expect(outcome.status).toBe('refused');
    if (outcome.status !== 'refused') return;
    expect(outcome.refusal.message).toBe(FILE_NOT_READABLE);
  });

  it('names the file when it cannot be read as GPX at all', async () => {
    const outcome = await importing('<gpx><rte><rtept lat="1"', { name: 'broken.gpx' });

    expect(outcome.status).toBe('refused');
    if (outcome.status !== 'refused') return;
    expect(outcome.refusal.code).toBe('unreadable-file');
    expect(outcome.refusal.message).toContain('broken.gpx');
  });
});
