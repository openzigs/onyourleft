// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How a caption of the demo video looks — #3175's review, epic #3151.
 *
 * `render-script.ts` draws every caption in the page; what it draws with is
 * decided here, as plain CSS declarations, so the look is one table that a
 * test can hold to what a viewer needs, and the page is handed it as data.
 *
 * What the table keeps:
 *
 * - **Readable on a phone.** A 1080p frame on a phone held sideways is about
 *   65 mm tall, so 1 vh is about 0.65 mm. No line a viewer is meant to read
 *   in passing is under {@link READING_MIN_VH}; the closing card's credit
 *   lines, which are there to be found and not read at a glance, are no
 *   smaller than {@link CREDIT_MIN_VH}.
 * - **One hierarchy.** A title and the card say the product's name with the
 *   logo, then one heading, then statements; the card ends on the project's
 *   address, the call to action, which is its largest line after the heading
 *   and is drawn before the credits though the script lists it last.
 * - **No ragged wraps.** Every line is balanced and never hyphenated, so no
 *   caption ends on a single word or breaks one.
 * - **Lifted off the sky.** The realistic world's sky is bright and a cloud is
 *   the HUD's ink, so a caption has a shadow under it and the leader line and
 *   ring a dark edge.
 *
 * Pure: no DOM. Colours are the HUD's tokens (`src/design/theme.css`).
 */

/** How a caption is drawn: a callout beside its panel, or its own placement. */
export type CaptionKind = 'title' | 'lower-third' | 'callout' | 'card';

/** CSS declarations, as `element.style` takes them. */
export type Css = Readonly<Record<string, string>>;

/** The smallest a line read in passing is drawn, in vh. */
export const READING_MIN_VH = 3;
/** The smallest the closing card's credit lines are drawn, in vh. */
export const CREDIT_MIN_VH = 2.2;
/** The logo's height on a title and on the card, in vh; never over its own pixels. */
export const LOGO_VH = { title: 20, card: 18 } as const;

/** What a line of a caption is, which decides its size and its place on a card. */
export type LineRole = 'heading' | 'statement' | 'address' | 'credit';

/**
 * The role of line `index` of a caption's `count` lines, the first
 * `statements` of which after the heading are the script's own.
 *
 * A card's lines after its statements are the map credit and, last, the
 * project's address (`video-script.ts` §`cardLines`).
 */
export function lineRole(
  kind: CaptionKind,
  index: number,
  count: number,
  statements: number,
): LineRole {
  if (index === 0) return 'heading';
  if (kind !== 'card' || index <= statements) return 'statement';
  return index === count - 1 ? 'address' : 'credit';
}

const INK = 'var(--oyl-color-hud-ink)';
const MUTED = 'var(--oyl-color-hud-ink-muted)';
const SURFACE = 'var(--oyl-color-hud-surface)';

const vh = (value: number): string => `${String(value)}vh`;

/** A line's size in vh, by what it is and where. */
export function lineVh(kind: CaptionKind, role: LineRole): number {
  if (role === 'credit') return CREDIT_MIN_VH;
  if (role === 'address') return 3.8;
  if (role === 'statement') return kind === 'card' ? 3.2 : 3;
  if (kind === 'title') return 4.6;
  if (kind === 'card') return 6;
  return kind === 'callout' ? 3.6 : 4.2;
}

/** A line's declarations. */
function lineCss(kind: CaptionKind, role: LineRole, first: boolean): Css {
  const base: Record<string, string> = {
    margin: '0',
    fontSize: vh(lineVh(kind, role)),
    textWrap: 'balance',
    hyphens: 'none',
    overflowWrap: 'normal',
  };
  if (role === 'heading') return { ...base, fontWeight: '800', order: '0' };
  if (role === 'statement') {
    return {
      ...base,
      fontWeight: '600',
      order: '1',
      ...(kind === 'title' && first ? { marginTop: '0.25em' } : {}),
    };
  }
  if (role === 'address') {
    // The call to action: boxed like a control, and drawn above the credits.
    return {
      ...base,
      fontWeight: '700',
      order: '2',
      marginTop: vh(2.5),
      padding: '0.35em 0.9em',
      border: `${vh(0.3)} solid ${INK}`,
      borderRadius: 'var(--oyl-radius)',
    };
  }
  return {
    ...base,
    fontFamily: 'inherit',
    fontWeight: '400',
    color: MUTED,
    order: '3',
    maxWidth: '78%',
    ...(first ? { marginTop: vh(4) } : {}),
  };
}

/** Everything the page needs to draw one caption. */
export interface OverlayStyle {
  /** The caption's box. */
  readonly card: Css;
  /** Its lines, in the script's order. */
  readonly lines: readonly Css[];
  /** The logo's height in vh, where the caption has one. */
  readonly logoVh: number;
  /** The leader line, its dot and the ring: the `<svg>` they are drawn in. */
  readonly marks: Css;
}

/**
 * How a caption of `kind` with `count` lines is drawn; the first
 * `statements` lines after the heading are the script's own.
 */
export function overlayStyle(kind: CaptionKind, count: number, statements: number): OverlayStyle {
  const whole = kind === 'card';
  const roles = Array.from({ length: count }, (_, index) =>
    lineRole(kind, index, count, statements),
  );
  const card: Css = {
    position: 'absolute',
    left: '0',
    top: '0',
    visibility: 'hidden',
    boxSizing: 'border-box',
    background: SURFACE,
    color: INK,
    fontFamily: 'var(--oyl-font-family-display)',
    fontWeight: '700',
    fontSize: vh(lineVh(kind, 'heading')),
    lineHeight: '1.2',
    textAlign: kind === 'callout' ? 'left' : 'center',
    ...(whole
      ? {
          width: '100vw',
          height: '100vh',
          padding: `${vh(6)} 6vw`,
          borderRadius: '0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: vh(1.4),
        }
      : {
          width: 'max-content',
          maxWidth: kind === 'title' ? '84vw' : kind === 'callout' ? '36vw' : '64vw',
          padding: kind === 'title' ? `${vh(3)} ${vh(5)} ${vh(3.5)}` : '0.45em 0.8em',
          borderRadius: 'var(--oyl-radius)',
          boxShadow: `0 ${vh(0.6)} ${vh(2.4)} rgb(0 0 0 / 0.45)`,
        }),
  };
  return {
    card,
    lines: roles.map((role, index) => lineCss(kind, role, roles.indexOf(role) === index)),
    logoVh: whole ? LOGO_VH.card : LOGO_VH.title,
    marks: { filter: `drop-shadow(0 0 ${vh(0.35)} rgb(0 0 0 / 0.8))` },
  };
}
