// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The illustration kit's house rules, as a check over one rendered part —
 * #938. Test support, never shipped.
 *
 * A part is an `<svg aria-hidden="true" focusable="false">` with no text in it
 * and no colour of its own: every shape takes its paint from a class
 * (`paint.ts`), and no attribute or style value anywhere in it may be a colour
 * literal — a `#…`, a colour function, or a named colour. Kept apart from the
 * suite so the fixtures that prove it can fail (`illustration.test.tsx`
 * §"the check can fail") run the same function the parts are held to.
 */

import { ILLUSTRATION_PAINTS } from './paint';

/**
 * CSS's named colours (CSS Color 4 §6.1), plus `transparent` and
 * `currentcolor`. ⚠️ `currentcolor` is not a literal, and it is refused all
 * the same: a shape painted with it takes whatever colour the text around it
 * is, which is a colour no token names for art.
 */
export const NAMED_COLOURS: ReadonlySet<string> = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
    'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
    'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
    'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
    'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
    'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
    'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow ' +
    'yellowgreen transparent currentcolor'
  ).split(' '),
);

/**
 * CSS's system colours (CSS Color 4 §6.2), and the deprecated ones it still
 * requires a browser to accept (§6.2.1). Each is a colour the PLATFORM picks —
 * the user's theme, forced colours — and no token names it, so a shape painted
 * with one escapes the palette as surely as `#ff0000` does. Lower-case, as
 * {@link colourLiteralIn} compares them. Found by #967's review: until then
 * `fill="CanvasText"`, and `var(--oyl-x, CanvasText)`, passed.
 */
export const SYSTEM_COLOURS: ReadonlySet<string> = new Set(
  (
    'accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas ' +
    'canvastext field fieldtext graytext highlight highlighttext linktext mark marktext ' +
    'selecteditem selecteditemtext visitedtext ' +
    'activeborder activecaption appworkspace background buttonhighlight buttonshadow ' +
    'captiontext inactiveborder inactivecaption inactivecaptiontext infobackground infotext ' +
    'menu menutext scrollbar threeddarkshadow threedface threedhighlight threedlightshadow ' +
    'threedshadow window windowframe windowtext'
  ).split(' '),
);

/** A hex colour, or any CSS colour function. */
const COLOUR_SYNTAX = /#|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i;

/** Every element that draws something. */
const SHAPES = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polygon', 'polyline']);

/** The elements that would put words in a picture. */
const TEXT_ELEMENTS = new Set(['text', 'title', 'desc', 'tspan', 'textpath', 'foreignobject']);

/**
 * The elements that would draw something this check cannot see the paint of:
 * an `<image>` is somebody's pixels, and a `<use>` draws whatever it points at,
 * which may be outside the part and painted by nothing here (#967's review).
 * `<foreignObject>` is refused above, as a way to put words in.
 */
const OPAQUE_ELEMENTS = new Set(['image', 'use']);

const PAINT_CLASSES: ReadonlySet<string> = new Set(
  Object.values(ILLUSTRATION_PAINTS).map(({ className }) => className),
);

/** A colour literal in one value, as a sentence, or `undefined` for none. */
export function colourLiteralIn(value: string): string | undefined {
  if (COLOUR_SYNTAX.test(value)) {
    return `a colour literal in “${value}”`;
  }
  // A word is a whole CSS identifier, hyphens and all, so a class such as
  // `oyl-illo__mark` is not the system colour `Mark`, and a custom property's
  // name (`--oyl-color-canvas`) is one word that is no colour — it is not cut
  // into `canvas`. A declaration's property (`background:` in a style) is a
  // name rather than a value, and is taken out before the scan.
  const values = value.toLowerCase().replaceAll(/[\w-]+\s*:/g, ' ');
  for (const word of values.match(/[\w-]+/g) ?? []) {
    if (NAMED_COLOURS.has(word)) {
      return `the named colour “${word}” in “${value}”`;
    }
    if (SYSTEM_COLOURS.has(word)) {
      return `the system colour “${word}” in “${value}”`;
    }
  }
  return undefined;
}

function paintedByClass(shape: Element, root: Element): boolean {
  for (let at: Element | null = shape; at !== null; at = at.parentElement) {
    if ([...at.classList].some((name) => PAINT_CLASSES.has(name))) {
      return true;
    }
    if (at === root) {
      break;
    }
  }
  return false;
}

/**
 * Every way `root` breaks the kit's rules, as sentences. Empty when it keeps
 * them all.
 */
export function illustrationFaults(root: Element): readonly string[] {
  const faults: string[] = [];
  if (root.tagName.toLowerCase() !== 'svg') {
    faults.push(`renders a <${root.tagName.toLowerCase()}>, not an <svg>`);
  }
  if (root.getAttribute('aria-hidden') !== 'true') {
    faults.push('is not aria-hidden="true"');
  }
  if (root.getAttribute('focusable') !== 'false') {
    faults.push('is not focusable="false"');
  }
  if ((root.textContent ?? '').trim() !== '') {
    faults.push(`carries text: “${(root.textContent ?? '').trim()}”`);
  }
  for (const element of [root, ...root.querySelectorAll('*')]) {
    const tag = element.tagName.toLowerCase();
    if (TEXT_ELEMENTS.has(tag) || OPAQUE_ELEMENTS.has(tag)) {
      faults.push(`holds a <${tag}>`);
    }
    for (const { name, value } of element.attributes) {
      const literal = colourLiteralIn(value);
      if (literal !== undefined) {
        faults.push(`<${tag} ${name}>: ${literal}`);
      }
    }
    if (SHAPES.has(tag) && !paintedByClass(element, root)) {
      faults.push(`a <${tag}> takes no paint from ILLUSTRATION_PAINTS`);
    }
  }
  return faults;
}
