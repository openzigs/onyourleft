// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The checker's own suite.
 *
 * `routes.a11y.test.tsx` asserts that every route produces **no** violations,
 * and that assertion is worth exactly as much as the proof that the rules can
 * produce one at all. A rule that silently stopped matching would leave that
 * suite green over a broken page — the same shape as a test written after the
 * fix that passes against the unfixed code.
 *
 * So every rule here gets a fixture it must reject, and the clean baseline they
 * are all mutated from must be accepted. The last case in the file requires
 * every rule in `ACCESSIBILITY_RULES` to appear somewhere above, so a rule added
 * without a fixture fails the build rather than being quietly untested.
 */

import { describe, expect, it } from 'vitest';

import {
  ACCESSIBILITY_RULES,
  accessibleName,
  auditAccessibility,
  formatViolations,
  isHiddenFromAssistiveTechnology,
  keyboardReachableElements,
  tabbableElements,
} from './audit';

/** The markup every fixture below is a one-change mutation of. */
const CLEAN_BODY = `
  <header><nav aria-label="Primary"><ul><li><a href="#/">Ride</a></li></ul></nav></header>
  <main>
    <h1 id="title">Ride</h1>
    <h2>Sensors</h2>
    <p>Nothing paired.</p>
    <button type="button">Start a ride</button>
    <label for="name">Ride name</label>
    <input id="name" type="text" />
    <img src="chart.png" alt="" />
  </main>
`;

function documentWith(body: string, lang = 'en'): Document {
  const doc = document.implementation.createHTMLDocument('fixture');
  if (lang !== '') {
    doc.documentElement.setAttribute('lang', lang);
  } else {
    doc.documentElement.removeAttribute('lang');
  }
  doc.body.innerHTML = body;
  return doc;
}

function rulesFiredBy(body: string, lang = 'en'): string[] {
  return auditAccessibility(documentWith(body, lang)).map((violation) => violation.rule);
}

/** Every rule id this file has proved can fire. Checked for completeness below. */
const proved = new Set<string>();

function expectRule(rule: string, body: string, lang = 'en'): void {
  const fired = rulesFiredBy(body, lang);
  expect(fired, `expected ${rule}, got ${fired.join(', ') || 'nothing'}`).toContain(rule);
  proved.add(rule);
}

describe('the clean baseline', () => {
  it('produces no violations at all', () => {
    const violations = auditAccessibility(documentWith(CLEAN_BODY));
    expect(formatViolations(violations)).toBe('');
    expect(violations).toEqual([]);
  });
});

describe('each rule rejects the failure it is for', () => {
  it('html-has-lang: a document with no language', () => {
    expectRule('html-has-lang', CLEAN_BODY, '');
  });

  it('page-has-one-main: no main landmark', () => {
    expectRule(
      'page-has-one-main',
      CLEAN_BODY.replace('<main>', '<div>').replace('</main>', '</div>'),
    );
  });

  it('page-has-one-main: two main landmarks', () => {
    expectRule('page-has-one-main', `${CLEAN_BODY}<main><h2>Second</h2></main>`);
  });

  it('page-has-one-h1: no h1', () => {
    expectRule('page-has-one-h1', CLEAN_BODY.replace('<h1 id="title">Ride</h1>', ''));
  });

  it('page-has-one-h1: two h1s', () => {
    expectRule('page-has-one-h1', CLEAN_BODY.replace('<h2>Sensors</h2>', '<h1>Sensors</h1>'));
  });

  it('heading-order: a level skipped', () => {
    expectRule('heading-order', CLEAN_BODY.replace('<h2>Sensors</h2>', '<h4>Sensors</h4>'));
  });

  it('heading-order: an outline that starts below h1', () => {
    // `page-has-one-h1` does not cover this: the `h1` is still present and
    // still unique, it is just not the first heading. Before #143 the first
    // heading was exempt from the sequence check entirely, so a page opening
    // at `h3` produced no violation at all.
    expectRule(
      'heading-order',
      CLEAN_BODY.replace(
        '<h1 id="title">Ride</h1>\n    <h2>Sensors</h2>',
        '<h3>Sensors</h3>\n    <h1 id="title">Ride</h1>',
      ),
    );
  });

  it('heading-order: an empty heading', () => {
    expectRule('heading-order', CLEAN_BODY.replace('<h2>Sensors</h2>', '<h2></h2>'));
  });

  it('control-has-accessible-name: a button with nothing to announce', () => {
    expectRule(
      'control-has-accessible-name',
      CLEAN_BODY.replace(
        '<button type="button">Start a ride</button>',
        '<button type="button"></button>',
      ),
    );
  });

  it('control-has-accessible-name: an input whose label points nowhere', () => {
    expectRule(
      'control-has-accessible-name',
      CLEAN_BODY.replace(
        '<label for="name">Ride name</label>',
        '<label for="other">Ride name</label>',
      ),
    );
  });

  it('control-has-accessible-name: a button labelled only by an aria-hidden glyph', () => {
    // The trap this rule exists for. `textContent` would call this button
    // named; a screen reader announces "button" and nothing else.
    expectRule(
      'control-has-accessible-name',
      CLEAN_BODY.replace(
        '<button type="button">Start a ride</button>',
        '<button type="button"><span aria-hidden="true">▶</span></button>',
      ),
    );
  });

  it('interactive-role-is-focusable: a div pretending to be a button', () => {
    expectRule(
      'interactive-role-is-focusable',
      CLEAN_BODY.replace(
        '<button type="button">Start a ride</button>',
        '<div role="button">Start a ride</div>',
      ),
    );
  });

  it('no-positive-tabindex: a control lifted out of reading order', () => {
    expectRule(
      'no-positive-tabindex',
      CLEAN_BODY.replace('<button type="button">', '<button type="button" tabindex="3">'),
    );
  });

  it('link-has-href: an anchor a keyboard cannot reach', () => {
    expectRule('link-has-href', CLEAN_BODY.replace('<a href="#/">Ride</a>', '<a>Ride</a>'));
  });

  it('image-has-alt: a missing attribute, which is not the same as an empty one', () => {
    expectRule(
      'image-has-alt',
      CLEAN_BODY.replace('<img src="chart.png" alt="" />', '<img src="chart.png" />'),
    );
  });

  it('aria-hidden-not-focusable: focus lands where nothing is announced', () => {
    expectRule(
      'aria-hidden-not-focusable',
      CLEAN_BODY.replace(
        '<button type="button">Start a ride</button>',
        '<div aria-hidden="true"><button type="button">Start a ride</button></div>',
      ),
    );
  });

  it('name-on-prohibited-role: a span whose whole meaning is in an aria-label', () => {
    // The shape #49's review found on the ride screen: the metric value said
    // "Heart rate: unavailable — no reading for 12 s" in an attribute a
    // `generic` element may have its label dropped from, over a visible em
    // dash. Nothing else in the fixture changes, so the rule is what fires.
    expectRule(
      'name-on-prohibited-role',
      CLEAN_BODY.replace('<p>Nothing paired.</p>', '<p><span aria-label="248 W">—</span></p>'),
    );
  });

  it('name-on-prohibited-role: leaves an element that declares a role alone', () => {
    // A role that takes a name is somebody's deliberate choice, and the other
    // rules judge it. Only the roles ARIA prohibits a name on are this rule's.
    const fired = rulesFiredBy(
      CLEAN_BODY.replace('<p>Nothing paired.</p>', '<div role="status" aria-label="Saved"></div>'),
    );
    expect(fired).not.toContain('name-on-prohibited-role');
  });

  it('aria-reference-resolves: a labelledby pointing at nothing', () => {
    expectRule(
      'aria-reference-resolves',
      CLEAN_BODY.replace('<main>', '<main aria-labelledby="missing-title">'),
    );
  });

  it('unique-id: the same id twice, so every reference resolves to the first', () => {
    expectRule('unique-id', CLEAN_BODY.replace('<h2>Sensors</h2>', '<h2 id="title">Sensors</h2>'));
  });

  it('list-structure: a stray element between the list items', () => {
    expectRule(
      'list-structure',
      CLEAN_BODY.replace('<li><a href="#/">Ride</a></li>', '<div><a href="#/">Ride</a></div>'),
    );
  });

  it('landmarks-are-distinguishable: two navs a reader cannot tell apart', () => {
    expectRule(
      'landmarks-are-distinguishable',
      `${CLEAN_BODY}<nav><ul><li><a href="#/about">About</a></li></ul></nav>`,
    );
  });

  it('table-in-scroll-region: a table a phone can only fit by widening the page', () => {
    expectRule(
      'table-in-scroll-region',
      `${CLEAN_BODY}<table><caption>Laps</caption><tr><td>1</td></tr></table>`,
    );
  });
});

describe('the rules that are easy to get right for the wrong reason', () => {
  it('does not fire control-has-accessible-name on a label that wraps its input', () => {
    expect(
      rulesFiredBy(
        CLEAN_BODY.replace(
          '<label for="name">Ride name</label>\n    <input id="name" type="text" />',
          '<label>Ride name <input type="text" /></label>',
        ),
      ),
    ).toEqual([]);
  });

  it('accepts an aria-label where there is no visible text', () => {
    expect(
      rulesFiredBy(
        CLEAN_BODY.replace(
          '<button type="button">Start a ride</button>',
          '<button type="button" aria-label="Start a ride"><span aria-hidden="true">▶</span></button>',
        ),
      ),
    ).toEqual([]);
  });

  it('accepts a div with an interactive role once it is focusable and named', () => {
    expect(
      rulesFiredBy(
        CLEAN_BODY.replace(
          '<button type="button">Start a ride</button>',
          '<div role="button" tabindex="0">Start a ride</div>',
        ),
      ),
    ).toEqual([]);
  });

  it('ignores a hidden control rather than demanding a name for it', () => {
    expect(
      rulesFiredBy(
        CLEAN_BODY.replace(
          '<button type="button">Start a ride</button>',
          '<button type="button" hidden></button>',
        ),
      ),
    ).toEqual([]);
  });

  it('does not treat a disabled button as unreachable', () => {
    // A disabled control is legitimately out of the tab order. Firing
    // `interactive-role-is-focusable` on it would make the rule unusable and
    // the usual response would be to delete the rule.
    expect(
      rulesFiredBy(CLEAN_BODY.replace('<button type="button">', '<button type="button" disabled>')),
    ).toEqual([]);
  });
});

describe('tabbableElements', () => {
  it('returns the controls a keyboard reaches, in document order', () => {
    const doc = documentWith(CLEAN_BODY);
    expect(tabbableElements(doc).map((element) => element.tagName)).toEqual([
      'A',
      'BUTTON',
      'INPUT',
    ]);
  });

  it('excludes tabindex="-1", so a focus target is not also a tab stop', () => {
    const doc = documentWith(CLEAN_BODY.replace('<main>', '<main tabindex="-1">'));
    expect(tabbableElements(doc).map((element) => element.tagName)).not.toContain('MAIN');
  });

  it('excludes a disabled control and a hidden one', () => {
    const doc = documentWith(
      CLEAN_BODY.replace('<button type="button">', '<button type="button" disabled>').replace(
        '<input id="name" type="text" />',
        '<input id="name" type="text" hidden />',
      ),
    );
    expect(tabbableElements(doc).map((element) => element.tagName)).toEqual(['A']);
  });

  it('KEEPS an aria-disabled control, because no browser takes one out (#255)', () => {
    // ⚠️ The model used to drop it, which made it disagree with every browser
    // and made the only correct fix for #255's keyboard defect read as a
    // regression in the keyboard tests. `audit.ts` §`removedFromTabOrder` says
    // why the attribute and the ARIA state are different questions: the whole
    // reason to reach for `aria-disabled` is to keep a blocked control
    // reachable so it can explain itself.
    const doc = documentWith(
      CLEAN_BODY.replace('<button type="button">', '<button type="button" aria-disabled="true">'),
    );

    expect(tabbableElements(doc).map((element) => element.tagName)).toEqual([
      'A',
      'BUTTON',
      'INPUT',
    ]);
  });

  it('still exempts an aria-disabled control from having to be focusable', () => {
    // The other half of the split, and the reason `isDisabled` survives: a
    // `div role="button" aria-disabled="true"` is inert, so
    // `interactive-role-is-focusable` must not demand a tab stop for it.
    expect(
      rulesFiredBy(
        CLEAN_BODY.replace(
          '<button type="button">Start a ride</button>',
          '<div role="button" aria-disabled="true">Start a ride</div>',
        ),
      ),
    ).toEqual([]);
  });
});

/**
 * The tab order through a radio group (#698).
 *
 * Chromium makes a named radio group ONE tab stop — the checked radio, or the
 * first when none is checked — and `controls-first.browser.spec.ts` holds the
 * model to real Tab presses on Settings. These fixtures pin each branch.
 */
describe('tabbableElements and a radio group (#698)', () => {
  function tabOrder(body: string): string[] {
    return tabbableElements(documentWith(body)).map((element) => element.id);
  }

  function reachable(body: string): string[] {
    return keyboardReachableElements(documentWith(body)).map((element) => element.id);
  }

  const GROUP = (checked: 'a' | 'b' | 'c' | '') => `
    <button id="before" type="button">Before</button>
    <input id="a" type="radio" name="units" ${checked === 'a' ? 'checked' : ''} />
    <input id="b" type="radio" name="units" ${checked === 'b' ? 'checked' : ''} />
    <input id="c" type="radio" name="units" ${checked === 'c' ? 'checked' : ''} />
    <button id="after" type="button">After</button>
  `;

  it('stops on the checked radio and on no other', () => {
    expect(tabOrder(GROUP('b'))).toEqual(['before', 'b', 'after']);
  });

  it('stops on the first radio when none is checked', () => {
    expect(tabOrder(GROUP(''))).toEqual(['before', 'a', 'after']);
  });

  it('keeps every radio with no name, which is a group of one', () => {
    expect(tabOrder('<input id="x" type="radio" /><input id="y" type="radio" checked />')).toEqual([
      'x',
      'y',
    ]);
  });

  it('keeps one stop per group when two groups sit side by side', () => {
    expect(
      tabOrder(`
        <input id="m" type="radio" name="units" checked /><input id="i" type="radio" name="units" />
        <input id="l" type="radio" name="lap" /><input id="r" type="radio" name="lap" />
      `),
    ).toEqual(['m', 'l']);
  });

  it('keeps apart two groups of one name in two forms', () => {
    expect(
      tabOrder(`
        <form><input id="p" type="radio" name="units" checked /><input id="q" type="radio" name="units" /></form>
        <form><input id="s" type="radio" name="units" /><input id="t" type="radio" name="units" /></form>
      `),
    ).toEqual(['p', 's']);
  });

  it('stops twice on an unchecked group another control splits, as Chromium does', () => {
    expect(
      tabOrder(`
        <input id="a" type="radio" name="units" />
        <button id="between" type="button">Between</button>
        <input id="b" type="radio" name="units" />
      `),
    ).toEqual(['a', 'between', 'b']);
  });

  it('takes a disabled first radio out, and the next one is the stop', () => {
    expect(
      tabOrder(`
        <input id="a" type="radio" name="units" disabled />
        <input id="b" type="radio" name="units" />
      `),
    ).toEqual(['b']);
  });

  it('reaches the rest of a group by arrow key once its stop is tabbable', () => {
    expect(reachable(GROUP('b'))).toEqual(['before', 'a', 'b', 'c', 'after']);
  });

  it('reaches no radio of a group whose checked radio is out of the tab order', () => {
    expect(
      reachable(`
        <input id="a" type="radio" name="units" />
        <input id="b" type="radio" name="units" checked tabindex="-1" />
      `),
    ).toEqual([]);
  });
});

/**
 * The tab order through a `<details>` disclosure (#665).
 *
 * A closed `<details>` renders its first `<summary>` and nothing else, so no
 * browser tabs to a link inside it. Each fixture below names its elements by
 * `id` so a failure says which one the model got wrong.
 */
describe('tabbableElements and the <details> disclosure (#665)', () => {
  function tabOrder(body: string): string[] {
    return tabbableElements(documentWith(body)).map((element) => element.id);
  }

  it('keeps a closed details’ summary and drops the link inside it', () => {
    expect(
      tabOrder(`
        <button id="before" type="button">Before</button>
        <details><summary id="summary">Why</summary><p><a id="link" href="#/">More</a></p></details>
        <button id="after" type="button">After</button>
      `),
    ).toEqual(['before', 'summary', 'after']);
  });

  it('keeps a link inside a closed details’ summary, which is rendered with it', () => {
    expect(
      tabOrder(
        '<details><summary id="s">Why <a id="l" href="#/">x</a></summary><a id="c" href="#/">c</a></details>',
      ),
    ).toEqual(['s', 'l']);
  });

  it('keeps both the summary and the link when the details is open', () => {
    expect(
      tabOrder(`
        <details open><summary id="summary">Why</summary><p><a id="link" href="#/">More</a></p></details>
      `),
    ).toEqual(['summary', 'link']);
  });

  it('drops everything inside an open details that is itself inside a closed one', () => {
    expect(
      tabOrder(`
        <details>
          <summary id="outer">Outer</summary>
          <details open>
            <summary id="inner">Inner</summary>
            <a id="link" href="#/">More</a>
          </details>
        </details>
      `),
    ).toEqual(['outer']);
  });

  it('drops the summary of a closed details nested inside a closed one', () => {
    expect(
      tabOrder(`
        <details>
          <summary id="outer">Outer</summary>
          <details><summary id="inner">Inner</summary></details>
        </details>
      `),
    ).toEqual(['outer']);
  });

  it('reaches a nested disclosure’s summary once the outer one is open', () => {
    expect(
      tabOrder(`
        <details open>
          <summary id="outer">Outer</summary>
          <details>
            <summary id="inner">Inner</summary>
            <a id="link" href="#/">More</a>
          </details>
        </details>
      `),
    ).toEqual(['outer', 'inner']);
  });

  it('treats only the FIRST summary as the exception; a second is ordinary content', () => {
    expect(
      tabOrder(`
        <details>
          <summary id="first">First</summary>
          <summary id="second" tabindex="0">Second</summary>
        </details>
      `),
    ).toEqual(['first']);
  });

  it('does not count a second summary as a tab stop even when the details is open', () => {
    // The HTML standard's focusable areas include "the summary for its parent
    // details" and no other summary; a second one has no activation behaviour.
    expect(
      tabOrder(`
        <details open>
          <summary id="first">First</summary>
          <summary id="second">Second</summary>
        </details>
      `),
    ).toEqual(['first']);
  });

  it('does not count a summary with no details parent as a tab stop', () => {
    expect(tabOrder('<div><summary id="stray">Stray</summary></div>')).toEqual([]);
  });

  it('does not report a link tucked in a closed details as unreachable by keyboard', () => {
    // It is reached by opening the summary first; `interactive-role-is-focusable`
    // asks about the page with its disclosures open.
    expect(
      rulesFiredBy(
        CLEAN_BODY.replace(
          '<p>Nothing paired.</p>',
          '<details><summary>Why</summary><p><a href="#/help">More</a></p></details>',
        ),
      ),
    ).toEqual([]);
  });

  it('still reports a fake button tucked in a closed details that no key could reach', () => {
    expect(
      rulesFiredBy(
        CLEAN_BODY.replace(
          '<p>Nothing paired.</p>',
          '<details><summary>Why</summary><div role="button">Pair</div></details>',
        ),
      ),
    ).toContain('interactive-role-is-focusable');
  });

  it('does not demand a tab stop or a name for a second summary, which is not a control', () => {
    expect(
      rulesFiredBy(
        CLEAN_BODY.replace(
          '<p>Nothing paired.</p>',
          '<details open><summary>Why</summary><summary></summary></details>',
        ),
      ),
    ).toEqual([]);
  });
});

describe('a summary that is not its details’ own (#665 review)', () => {
  it('still reports a stray summary that claims role="button" and cannot be reached', () => {
    expect(
      rulesFiredBy(
        CLEAN_BODY.replace(
          '<p>Nothing paired.</p>',
          '<div><summary role="button">Pair</summary></div>',
        ),
      ),
    ).toContain('interactive-role-is-focusable');
  });

  it('does not call a second summary under aria-hidden focusable, which no browser does', () => {
    expect(
      rulesFiredBy(
        CLEAN_BODY.replace(
          '<p>Nothing paired.</p>',
          '<details open aria-hidden="true"><summary tabindex="-1">Why</summary><summary>Also</summary></details>',
        ),
      ),
    ).toEqual([]);
  });

  it('still reports a second summary under aria-hidden that was given a tabindex', () => {
    expect(
      rulesFiredBy(
        CLEAN_BODY.replace(
          '<p>Nothing paired.</p>',
          '<div aria-hidden="true"><summary tabindex="0">Also</summary></div>',
        ),
      ),
    ).toContain('aria-hidden-not-focusable');
  });
});

describe('accessibleName', () => {
  it('prefers aria-labelledby over the element’s own text', () => {
    const doc = documentWith(
      `<main><h1 id="t">Ride</h1><span id="n">Begin</span><button aria-labelledby="n">Start</button></main>`,
    );
    const button = doc.querySelector('button');
    expect(button).not.toBeNull();
    expect(accessibleName(button as Element)).toBe('Begin');
  });

  it('falls through a labelledby that resolves to nothing rather than returning empty', () => {
    const doc = documentWith(
      `<main><h1>Ride</h1><button aria-labelledby="gone">Start</button></main>`,
    );
    const button = doc.querySelector('button');
    expect(accessibleName(button as Element)).toBe('Start');
  });
});

describe('isHiddenFromAssistiveTechnology', () => {
  it('follows the ancestor chain rather than looking only at the element', () => {
    const doc = documentWith(
      '<main><h1>Ride</h1><div hidden><p><span id="deep">x</span></p></div></main>',
    );
    const deep = doc.getElementById('deep');
    expect(deep).not.toBeNull();
    expect(isHiddenFromAssistiveTechnology(deep as Element)).toBe(true);
  });
});

describe('landmark naming follows ARIA rather than the generic name algorithm', () => {
  it('accepts two navs distinguished by aria-labelledby', () => {
    expect(
      rulesFiredBy(
        // The labelling heading sits AFTER the clean body rather than before
        // it: since #143 the first heading in a document must be the `h1`, and
        // a fixture that opened on this `h2` would fire `heading-order` and
        // fail this case for a reason that has nothing to do with landmarks.
        `${CLEAN_BODY}
         <h2 id="secondary-label">Secondary</h2>
         <nav aria-labelledby="secondary-label"><ul><li><a href="#/about">About</a></li></ul></nav>`,
      ),
    ).toEqual([]);
  });

  it('still rejects two navs whose only difference is their link text', () => {
    // The regression this guards. `accessibleName` falls through to an
    // element's own text; a landmark's name never does, so an unlabelled `nav`
    // containing a link called "About" is unnamed rather than named "About".
    expect(
      rulesFiredBy(`${CLEAN_BODY}<nav><ul><li><a href="#/about">About</a></li></ul></nav>`),
    ).toContain('landmarks-are-distinguishable');
  });

  it('falls back to aria-label when aria-labelledby resolves to empty text', () => {
    // Not a *dangling* reference — that is its own violation, and using one
    // here would have made this case pass for the wrong reason. This is a
    // reference that resolves to an element with nothing in it, which is the
    // shape a template produces when the label has not loaded.
    expect(
      rulesFiredBy(
        `${CLEAN_BODY}<span id="blank"></span>
         <nav aria-labelledby="blank" aria-label="Secondary"><ul><li><a href="#/about">About</a></li></ul></nav>`,
      ),
    ).toEqual([]);
  });
});

describe('landmarks-are-distinguishable reads a declared role as well as a tag — #690', () => {
  const region = (caption: string, id: string): string =>
    `<div role="region" tabindex="0" aria-labelledby="${id}"><table><caption id="${id}">${caption}</caption><tr><td>1</td></tr></table></div>`;

  it('fires on two table regions captioned alike', () => {
    expect(rulesFiredBy(`${CLEAN_BODY}${region('Laps', 'a')}${region('Laps', 'b')}`)).toContain(
      'landmarks-are-distinguishable',
    );
  });

  it('accepts two table regions captioned apart', () => {
    expect(rulesFiredBy(`${CLEAN_BODY}${region('Laps', 'a')}${region('Efforts', 'b')}`)).toEqual(
      [],
    );
  });

  it('fires on a table region named like a named section', () => {
    expect(
      rulesFiredBy(
        `${CLEAN_BODY}<section aria-label="Laps"><p>x</p></section>${region('Laps', 'a')}`,
      ),
    ).toContain('landmarks-are-distinguishable');
  });

  it('does not hold an unnamed section, which is no landmark, against one table region', () => {
    expect(
      rulesFiredBy(`${CLEAN_BODY}<section><h2>Laps</h2></section>${region('Laps', 'a')}`),
    ).toEqual([]);
  });

  it('does not count an unnamed section, so a lone unnamed region is not one of two', () => {
    expect(
      rulesFiredBy(
        `${CLEAN_BODY}<section><h2>Laps</h2></section><div role="region"><p>x</p></div>`,
      ),
    ).not.toContain('landmarks-are-distinguishable');
  });

  it('fires on an unnamed nav beside an unnamed navigation role — #864', () => {
    // An unnamed `nav` is a navigation landmark (HTML-AAM), unlike an unnamed
    // `section`, so the declared role is the second of two with no name.
    const body = CLEAN_BODY.replace('<nav aria-label="Primary">', '<nav>');
    expect(rulesFiredBy(`${body}<div role="navigation"><a href="#/">Ride</a></div>`)).toContain(
      'landmarks-are-distinguishable',
    );
  });

  it('fires on an unnamed aside beside an unnamed complementary role — #864', () => {
    expect(
      rulesFiredBy(`${CLEAN_BODY}<aside><p>x</p></aside><div role="complementary"><p>y</p></div>`),
    ).toContain('landmarks-are-distinguishable');
  });

  it('accepts one unnamed nav beside one NAMED navigation role — #864', () => {
    const body = CLEAN_BODY.replace('<nav aria-label="Primary">', '<nav>');
    expect(
      rulesFiredBy(`${body}<div role="navigation" aria-label="Pages"><a href="#/">Ride</a></div>`),
    ).toEqual([]);
  });

  it('fires on two navigation roles named alike, whatever their tags', () => {
    expect(
      rulesFiredBy(
        `${CLEAN_BODY}<div role="navigation" aria-label="Primary"><a href="#/">Ride</a></div>`,
      ),
    ).toContain('landmarks-are-distinguishable');
  });
});

describe('table-in-scroll-region asks for all three, and of the parent — #660', () => {
  const table = '<table id="t"><caption id="c">Laps</caption><tr><td>1</td></tr></table>';

  it('accepts a table inside a focusable region named by its caption', () => {
    expect(
      rulesFiredBy(
        `${CLEAN_BODY}<div role="region" tabindex="0" aria-labelledby="c">${table}</div>`,
      ),
    ).toEqual([]);
  });

  it('fires on a region that cannot take focus', () => {
    expect(
      rulesFiredBy(`${CLEAN_BODY}<div role="region" aria-labelledby="c">${table}</div>`),
    ).toContain('table-in-scroll-region');
  });

  it('fires on a focusable box with no role', () => {
    expect(
      rulesFiredBy(`${CLEAN_BODY}<div tabindex="0" aria-labelledby="c">${table}</div>`),
    ).toContain('table-in-scroll-region');
  });

  it('fires on a focusable region with no name, even though the table has one', () => {
    expect(rulesFiredBy(`${CLEAN_BODY}<div role="region" tabindex="0">${table}</div>`)).toContain(
      'table-in-scroll-region',
    );
  });

  it('fires when the region is an ancestor further up rather than the parent', () => {
    expect(
      rulesFiredBy(
        `${CLEAN_BODY}<div role="region" tabindex="0" aria-label="Everything"><div>${table}</div></div>`,
      ),
    ).toContain('table-in-scroll-region');
  });
});

describe('heading-order ignores what a reader ignores', () => {
  it('does not count a hidden heading when checking the sequence', () => {
    // Without the skip, a `hidden` h4 between an h1 and an h2 would report a
    // skipped level that nobody can hear.
    expect(
      rulesFiredBy(
        CLEAN_BODY.replace('<h2>Sensors</h2>', '<h4 hidden>Hidden</h4><h2>Sensors</h2>'),
      ),
    ).toEqual([]);
  });
});

describe('formatViolations', () => {
  it('names the rule, the reason and the element on separate lines', () => {
    const violations = auditAccessibility(
      documentWith(CLEAN_BODY.replace('<a href="#/">Ride</a>', '<a>Ride</a>')),
    );
    const report = formatViolations(violations);
    expect(report).toContain('[link-has-href]');
    expect(report).toContain('not focusable');
    expect(report).toContain('<a>Ride</a>');
  });

  it('truncates a long element rather than pasting a whole subtree into the log', () => {
    const violations = auditAccessibility(
      documentWith(
        `<main><h1>Ride</h1><button type="button"><span aria-hidden="true">${'x'.repeat(400)}</span></button></main>`,
      ),
    );
    expect(violations.map((violation) => violation.rule)).toEqual(['control-has-accessible-name']);
    expect(violations[0]?.html).toHaveLength(158);
    expect(violations[0]?.html.endsWith('…')).toBe(true);
  });
});

describe('the rule set is completely covered', () => {
  it('has a failing fixture for every rule', () => {
    const declared = ACCESSIBILITY_RULES.map(([id]) => id);
    expect([...declared].sort()).toEqual([...proved].sort());
  });
});
