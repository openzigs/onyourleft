// SPDX-License-Identifier: AGPL-3.0-or-later

import { Info } from 'lucide-react';
import type { JSX, ReactNode } from 'react';

/**
 * A section's heading with its help behind an ⓘ — #1013.
 *
 * The owner's #993 ruling, one level down: a SCREEN keeps one line under its
 * title and the rest behind `ScreenHelp`'s ⓘ, and a SECTION of a screen keeps
 * at most one short line under its heading and the rest behind this one.
 * `a11y/section-lines.ts` is the rule as something a test counts.
 *
 * It is `ScreenHelp`'s pattern and for `ScreenHelp`'s reasons — a native
 * `<details>`, so the role, the expanded state, Enter and Space and the tab
 * order are the platform's; its words are in the page while it is closed, so
 * they are there offline and `a11y/route-sentences.a11y.test.tsx` still finds
 * every one. The heading and the ⓘ are one row: the ⓘ stands at the end of the
 * heading's line and the panel opens beneath the heading, in the flow, before
 * the section's controls — the order a keyboard reaches them in too.
 *
 * ## Its name and its target
 *
 * The summary shows the glyph alone, so its name is the words beside it in a
 * visually hidden span, *"Help with …"* and the section's heading, which is
 * what tells two ⓘ on one screen apart (WCAG 2.2 SC 2.4.6). The 44 × 44 target
 * is DECLARED in `theme.css` §`.oyl-section-help`, as `.oyl-help`'s is (SC
 * 2.5.5, #316's reason), and `controls-first.browser.spec.ts` §"#1013"
 * measures it with the declaration stripped as its control.
 *
 * ## What it is not for
 *
 * **No safety, privacy or consent sentence goes in here**, the same rule as
 * `MoreAbout` and `ScreenHelp`: those are a view's `*_KEPT_VISIBLE` list, and
 * `a11y/kept-visible.a11y.test.tsx` fails one that is tucked.
 */
export function SectionHeading({
  level,
  id,
  tabIndex,
  children,
  help,
}: {
  /** The heading's level, as the outline needs it. */
  readonly level: 2 | 3 | 4;
  /** The heading's id, where a section is labelled by it. */
  readonly id?: string;
  /** `-1` where something moves focus to the heading, as the Routes import does. */
  readonly tabIndex?: -1;
  /** The heading's words, which also complete "Help with …". */
  readonly children: string;
  /** What the ⓘ holds: paragraphs, and anything else a section explains itself with. */
  readonly help: ReactNode;
}): JSX.Element {
  const Heading = `h${String(level)}` as 'h2' | 'h3' | 'h4';
  return (
    <div className="oyl-section-head">
      <Heading id={id} tabIndex={tabIndex}>
        {children}
      </Heading>
      <details className="oyl-section-help">
        <summary>
          <Info aria-hidden="true" focusable="false" />
          <span className="oyl-visually-hidden">Help with {children}</span>
        </summary>
        <div className="oyl-section-help__panel">{help}</div>
      </details>
    </div>
  );
}
