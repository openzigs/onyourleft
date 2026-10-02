// SPDX-License-Identifier: AGPL-3.0-or-later

import { Info } from 'lucide-react';
import type { JSX } from 'react';

/**
 * A screen's help, behind an ⓘ beside its title — #993.
 *
 * The owner's ruling of 2026-10-02: *"one line is the right amount. We can
 * have help that gives further detail."* So a screen keeps ONE line under its
 * title (`shell/routes.ts` §`RouteDefinition.summary`), and the rest of what
 * its summary used to say is here, one press away.
 *
 * ## Why it is a native disclosure and not a popover
 *
 * ADR 0042 D-6 admits a Radix primitive where the accessibility is behaviour a
 * hand-written control would have to re-implement. A `<details>` already has
 * that behaviour from the platform: a role, an expanded state, Enter and Space,
 * and a tab order `a11y/audit.ts` models (#665). A popover would add a package,
 * a lazy chunk and a focus rule to say the same paragraphs. And the panel's
 * words are in the page whether it is open or not, so they are there offline
 * and `a11y/route-sentences.a11y.test.tsx` still finds every one.
 *
 * ## What it is not for
 *
 * The same thing `MoreAbout` is not for: **no safety or privacy sentence goes
 * in here.** Those are a route's `notes`, which the shell keeps on the screen
 * below the view (`RouteDefinition.notes`), and `a11y/kept-visible.a11y.test.tsx`
 * fails one that is tucked.
 *
 * ## Its name
 *
 * The summary shows the glyph alone, so its name is the words beside it in a
 * visually hidden span — *"Help with …"*, the screen's title. It starts with
 * the word a speech-control user would say for an ⓘ. The 44 × 44 target is
 * `theme.css` §`.oyl-help`'s, declared, and `controls-first.browser.spec.ts`
 * measures it with the declaration stripped as its control.
 */
export function ScreenHelp({
  title,
  paragraphs,
}: {
  /** The screen's title, which completes "Help with …". */
  readonly title: string;
  readonly paragraphs: readonly string[];
}): JSX.Element {
  return (
    <details className="oyl-help">
      <summary>
        <Info aria-hidden="true" focusable="false" />
        <span className="oyl-visually-hidden">Help with {title}</span>
      </summary>
      <div className="oyl-help__panel">
        {paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </details>
  );
}

/**
 * A route's safety or privacy sentences, kept on the screen BELOW its controls
 * — #993. They used to be the second sentence of the line under the title; the
 * owner's ruling moves them under what a rider came to do, as a compact note,
 * and never into the help. Marked `data-oyl-kept-visible`, so the browser
 * gate's fold rule and the kept-visible test both know them. On a list–detail
 * route at two panes they are at the end of the list pane instead
 * (`shell/ListDetail.tsx` §`notes`), so they take no height from the panes.
 */
export function ScreenNotes({ notes }: { readonly notes: readonly string[] }): JSX.Element {
  return (
    <div className="oyl-note" data-oyl-kept-visible="">
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </div>
  );
}
