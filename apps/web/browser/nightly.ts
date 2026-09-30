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
 * erasure); licences and notices; accessibility and layout; the wiring gate.
 * Every describe below draws the REALISTIC world, which is a rung a rider
 * chooses in Settings and is off by default (ADR 0026 D-3), or measures the
 * owner's instruments for it.
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
];
