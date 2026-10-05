// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which browser-gate checks run NIGHTLY rather than on every pull request —
 * #866, and the owner's ruling of 2026-09-29.
 *
 * ⚠️ **A nightly check cannot block a merge.** `main` requires one status
 * check, `Repository rules` (CLAUDE.md §4c), and the nightly workflow
 * (`.github/workflows/nightly.yml`) reports under another. A break in anything
 * listed here is found the next morning, by an issue the nightly run opens,
 * and not before the merge that caused it. The owner accepted that trade for
 * checks that are NOT safety gates, and only for those.
 *
 * So the list is REVIEWED, and `nightly-split.test.ts` holds it both ways: a
 * describe tagged {@link NIGHTLY} that is not listed here is a red build, and
 * so is an entry here that no describe carries. Moving a check out of the
 * required job is therefore an edit to this file, with a reason a reviewer
 * reads — never a tag added in passing to a spec.
 *
 * What may NOT be listed, whatever it costs (#866): anything that gates
 * trainer control; privacy (no network, no picture, masking, scoping,
 * erasure); licences and notices; accessibility and layout; the wiring gate —
 * with the owner's exceptions, named below: #1076's of 2026-10-03 and
 * #1137's of 2026-10-05. Any further exception is the owner's ruling,
 * recorded here and in CLAUDE.md §4c.
 * Four of the ten describes below draw the REALISTIC world, which is a rung
 * a rider chooses in Settings and is off by default (ADR 0026 D-3), or
 * measure the owner's instruments for it. The other six are the DEFAULT
 * world, every rider's, and each is an owner's exception. One is #1076's: the
 * reflow walk's DARK palette, which the owner moved on 2026-10-03 with its
 * light twin kept required — so layout stays a required gate, in the palette
 * every rider starts in, and what moved is the repeat of it in the other.
 *
 * The other five are #1137's (the owner's ruling of 2026-10-05, to bring the
 * required job 180 s clear of its stop on the EPYC 7763): four LAYOUT and
 * MOTION checks of the default world, in five describes — #941's card-shape
 * margins, #1072's card carry, #945's cross-fade and #1014's two-column
 * sections. Each entry names the required test that still holds the
 * accessibility or safety half of its claim; where a describe held both, it
 * was SPLIT and only the appearance half is tagged — reduced motion, focus, a
 * 44 × 44 target, an `aria-hidden` drawing and every
 * ride-route case of #945 stay required.
 */

/**
 * The Playwright tag. `playwright.config.ts` §`projects` runs every test that
 * carries it in the `nightly` project and in no other, and every test that
 * does not in `chromium` or `game` and not in `nightly`, so each test is in
 * exactly one of the two runs by construction.
 */
export const NIGHTLY = '@nightly';

/** One describe moved out of the required job. */
export interface NightlyCheck {
  /** The spec file, relative to `apps/web/browser/`. */
  readonly spec: string;
  /** The describe's title, exactly. */
  readonly describe: string;
  /**
   * What it cost, measured on the runner — the load it pays for, since its
   * cases read one shared load and take milliseconds each. Run 36634388848
   * (`main` at 6bd316f, AMD EPYC 9V45), except the two realistic loads, which
   * are #870's (R2) run 36651030916 (#879 at b79879e) — about 10 s more
   * each than #866's own nightly run 36646905533 read them (91 s and 72 s).
   */
  readonly seconds: string;
  /** Why it is not a safety gate. */
  readonly why: string;
}

export const NIGHTLY_CHECKS: readonly NightlyCheck[] = [
  {
    spec: 'game.browser.spec.ts',
    describe: 'scenery the camera passes is not cut by the near plane — #545',
    seconds: 'shares the `?realistic` load below',
    why:
      'what the realistic world draws near the camera. The stylised world has no near-field ' +
      'case here, and `near-field.test.ts` (nightly too) is the arithmetic.',
  },
  {
    spec: 'game.browser.spec.ts',
    describe: 'the realistic world — ADR 0026',
    seconds: '101 s: the `?realistic` load',
    why:
      'how the opt-in realistic world looks and what it costs. The DEFAULT world’s halves of ' +
      'its cases — #501’s shader compile and D-7’s "fetches none of the realistic set" — are ' +
      'NOT here: since #878’s review they are a required describe on the plain load, and ' +
      '`nightly-split.test.ts` refuses a nightly describe that reads it. What this describe ' +
      'still holds that is not purely appearance, disclosed so a reviewer need not open it: ' +
      '(1) D-7’s fallback — a realistic rung with no files draws the stylised world and says ' +
      'so; (2) #369, the realistic rider’s legs follow the cranks, the cadence rule the ' +
      'stylised rider’s #349 case keeps required; (3) ⚠️ the realistic road’s gradient ' +
      'CONTRAST after the light and AgX (#242, #425), an accessibility claim about a world a ' +
      'rider can choose in Settings (#475). Keeping (3) required means paying the whole ' +
      '`?realistic` load in the required job, which is the cost #866 exists to remove; it is ' +
      'moved pending the owner’s explicit acknowledgement (#878’s review). The stylised ' +
      'road’s gradient contrast stays required (#242). Since #870 (R2) (3) also holds #628’s ' +
      'floor, 3.5 : 1 with the road’s wear on; the rest of R2 here (#627’s ground, #629’s ' +
      'water, #679’s gantries) is appearance and cost.',
  },
  {
    spec: 'game.browser.spec.ts',
    describe: 'the trees’ levels of detail in the realistic world — #617',
    seconds: '82 s: the `?realistic&trees` load',
    why:
      'triangle and draw-call budgets and a hand-over with no pop, in the realistic world; ' +
      'since #870, #630’s far-band light and foliage breeze, which are appearance.',
  },
  {
    spec: 'realistic.browser.spec.ts',
    describe: 'the realistic page’s instruments — #616',
    seconds: '36 s: two loads of the owner’s page',
    why:
      'the owner’s measuring instruments (a triangle counter and a layer switch) for the ' +
      'realistic world; `realistic.html` is not a gate and ships in no build.',
  },
  {
    spec: 'reflow.browser.spec.ts',
    describe: 'the dark palette — #672, nightly since #1076',
    seconds: 'about 22 s on the EPYC 7763 (run 37131982824): six walks of every route',
    why:
      'the SAME reflow walk as the light palette’s, which stays required, repeated under a ' +
      'dark device. Colour moves no box, so what only this walk can find is a route that ' +
      'throws or lays out differently in the dark palette alone (a `color-scheme: dark` ' +
      'scrollbar). The dark palette’s colours stay required in `theme.browser.spec.ts`, ' +
      '`links`, `button-hierarchy` and `controls-first`. Moved on the owner’s ruling of ' +
      '2026-10-03 (#1076).',
  },
  {
    spec: 'list-detail.browser.spec.ts',
    describe: '#941 — the drawings’ cost to each primary',
    seconds:
      '32.6 s of case time on the EPYC 7763 (run 37244296171): eight margin walks and the control',
    why:
      'how far a primary action moves down once the cards carry their drawing, against ' +
      '#982’s bound, in both palettes. Layout, moved on the owner’s ruling of 2026-10-05 ' +
      '(#1137). Still required: the first control above the fold with the 50 px floor on every ' +
      'route at the tablet and the phone (`controls-first`), each primary’s place on the ' +
      'list–detail routes (#670 in this spec), and #941’s accessibility half — one ' +
      '`aria-hidden` drawing per card and the card link’s 44 × 44 target — in the describe ' +
      'that keeps #941’s name.',
  },
  {
    spec: 'list-detail.browser.spec.ts',
    describe: '#1072 — a card carried into its detail',
    seconds: '15.7 s of case time on the EPYC 7763 (run 37244296171): two walks',
    why:
      'that a press carries a card into its detail on every list–detail route at two ' +
      'viewports, and that a selection by address does not. Motion, moved on the owner’s ' +
      'ruling of 2026-10-05 (#1137). Still required: `#1072 — a card is not carried under ' +
      'reduced motion`, which also holds that a press with no preference DOES carry, as its ' +
      'control; and #670’s focus and selection cases, which run with the motion at no ' +
      'duration.',
  },
  {
    spec: 'motion.browser.spec.ts',
    describe: 'the route cross-fade — #945, how it runs',
    seconds: '3.2 s of case time on the EPYC 7763 (run 37244296171): three cases',
    why:
      'that a menu navigation starts exactly one view transition, its control, and that the ' +
      'fade lasts the medium motion token — appearance, moved on the owner’s ruling of ' +
      '2026-10-05 (#1137). ⚠️ Of #945’s 21.6 s only these 3.2 s are the fade alone: the ' +
      'reduced-motion pair (the owner’s), the ride routes that must never fade or be pressed ' +
      'through a fade (#945’s review, safety), focus and the title under a fade, and a failed ' +
      'chunk leaving no transition hanging stay in the required `the route cross-fade — #945`, ' +
      'whose ride-route case still counts one fade for a menu navigation as its control.',
  },
  {
    spec: 'sections.browser.spec.ts',
    describe: '#1014 — a screen of sections uses a tablet’s width',
    seconds: '16.6 s of case time on the EPYC 7763 (run 37244296171): four walks',
    why:
      'that the `sections` routes lay out in columns across a tablet both ways up, one column ' +
      'on a phone, with prose as the control. Layout, moved on the owner’s ruling of ' +
      '2026-10-05 (#1137). Still required: reflow at 320 px and on a phone (`reflow`), the ' +
      'first control above the fold on the tablet both ways up (`controls-first`), #1014’s ' +
      'detail panes and #1026’s row balance in this spec.',
  },
  {
    spec: 'sections.browser.spec.ts',
    describe: '#1014 — the sections are read across, in rows',
    seconds: '17.4 s of case time on the EPYC 7763 (run 37244296171): two walks of two pages',
    why:
      'that the sections are row-major on the tablet, with CSS columns as the control. ' +
      'Layout, moved on the owner’s ruling of 2026-10-05 (#1137). The grid places sections in ' +
      'DOM order with no `dense` packing, so the tab order is not this layout’s to change; ' +
      'still required are #1026’s row balance in this spec, and `controls-first` and `reflow`.',
  },
];
