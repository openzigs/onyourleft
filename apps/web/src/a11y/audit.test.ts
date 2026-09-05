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
        `<h2 id="secondary-label">Secondary</h2>
         ${CLEAN_BODY}
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
