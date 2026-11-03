// SPDX-License-Identifier: AGPL-3.0-or-later
// Throwaway generator for #2035's design-direction options. Not product code.
import { readFileSync, writeFileSync } from 'node:fs';
import { contrastRatio, relativeLuminance } from '../../src/design/contrast.ts';

const here = new URL('.', import.meta.url).pathname;
const dump = JSON.parse(readFileSync(here + 'tokens-dump.json', 'utf8'));

// ---------- colour maths ----------
function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const enc = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
const dec = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const inGamut = (rgb: number[]) => rgb.every((x) => x >= -1e-4 && x <= 1 + 1e-4);
function toHexLinear(rgb: number[]): string {
  return (
    '#' +
    rgb
      .map((x) => Math.round(Math.min(1, Math.max(0, enc(Math.min(1, Math.max(0, x))))) * 255))
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
  );
}
function oklch(L: number, C: number, h: number): string {
  const rad = (h * Math.PI) / 180;
  let lo = 0, hi = C;
  // reduce chroma to gamut
  if (!inGamut(oklabToLinear(L, C * Math.cos(rad), C * Math.sin(rad)))) {
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLinear(L, mid * Math.cos(rad), mid * Math.sin(rad)))) lo = mid;
      else hi = mid;
    }
    C = lo;
  }
  return toHexLinear(oklabToLinear(L, C * Math.cos(rad), C * Math.sin(rad)));
}
/** A colour of hue h and chroma c whose WCAG relative luminance is Y. */
function hY(h: number, c: number, Y: number): string {
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (relativeLuminance(oklch(mid, c, h)) < Y) lo = mid;
    else hi = mid;
  }
  return oklch((lo + hi) / 2, c, h);
}
const Y = (hex: string) => relativeLuminance(hex);
const above = (bg: string, r: number) => r * (Y(bg) + 0.05) - 0.05;
const below = (bg: string, r: number) => (Y(bg) + 0.05) / r - 0.05;
/** One elevation step from a colour, lighter or darker, at ratio r. */
const step = (from: string, r: number, h: number, c: number, dir: 'lighter' | 'darker') =>
  hY(h, c, dir === 'lighter' ? above(from, r) : below(from, r));

// ---------- colour-vision deficiency (Machado, Oliveira & Fernandes 2009, severity 1) ----------
const CVD: Record<string, number[][]> = {
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};
function simulate(hex: string, kind: string): string {
  const lin = [1, 3, 5].map((i) => dec(Number.parseInt(hex.slice(i, i + 2), 16) / 255));
  const m = CVD[kind]!;
  return toHexLinear(m.map((row) => row[0]! * lin[0]! + row[1]! * lin[1]! + row[2]! * lin[2]!));
}

// ---------- option specs ----------
type Theme = 'dark' | 'light';
type Palette = Record<string, string>;
interface Option {
  id: string;
  name: string;
  accentSource: string;
  build: (t: Theme) => Palette;
  hud: Palette;
}

const ZONES = [
  ['bandRecovery', 1, 'Recovery'],
  ['bandEndurance', 2, 'Endurance'],
  ['bandTempo', 3, 'Tempo'],
  ['bandThreshold', 4, 'Threshold'],
  ['bandVo2', 5, 'VO₂'],
  ['bandAnaerobic', 6, 'Anaerobic'],
  ['bandSprint', 7, 'Sprint'],
] as const;

/** Zone ramp: grey, blue, green, yellow, orange, red, purple; lightness zig-zags so neighbours differ. */
function zones(t: Theme, surface: string, chroma: number, hues = [250, 255, 148, 98, 58, 27, 312]): Palette {
  const dark = t === 'dark';
  // target luminance per zone
  const floor = dark ? above(surface, 3.2) : 0;
  const Ys = (dark ? [0.32, 0.165, 0.43, 0.74, 0.41, 0.2, 0.4] : [0.165, 0.062, 0.15, 0.225, 0.11, 0.05, 0.11]).map((y) => Math.max(y, floor));
  const out: Palette = {};
  ZONES.forEach(([tok], i) => {
    out[tok] = hY(hues[i]!, i === 0 ? 0.012 : chroma, Ys[i]!);
  });
  // light theme: never above the 3:1 ceiling on surface
  if (!dark) for (const k of Object.keys(out)) if (contrastRatio(out[k]!, surface) < 3.08) out[k] = hY(hues[Object.keys(out).indexOf(k)]!, chroma, below(surface, 3.12));
  return out;
}

/** Status tones shared in shape by every option: info, success, warning, danger. */
function status(t: Theme, canvas: string, link: Palette): Palette {
  const tones: Record<string, number> = { info: 245, success: 150, warning: 80, danger: 25 };
  const out: Palette = {};
  for (const [name, h] of Object.entries(tones)) {
    if (t === 'dark') {
      out[`${name}Surface`] = hY(h, 0.045, 0.022);
      out[`${name}Ink`] = hY(h, 0.09, 0.56);
      out[`${name}Border`] = hY(h, 0.12, above(canvas, 3.6));
    } else {
      out[`${name}Surface`] = hY(h, 0.035, 0.84);
      out[`${name}Ink`] = hY(h, 0.11, 0.06);
      out[`${name}Border`] = hY(h, 0.13, below(canvas, 3.7));
    }
  }
  if (t === 'dark') {
    out.dangerAction = hY(25, 0.14, 0.4);
    out.dangerActionInk = hY(25, 0.05, 0.012);
  } else {
    out.dangerAction = hY(25, 0.17, 0.085);
    out.dangerActionInk = '#ffffff';
  }
  void link;
  return out;
}

interface Base {
  neutralHue: number;
  neutralChroma: number;
  canvasY: number;
  step: number;
  inkY: number;
}
function neutrals(t: Theme, b: Base): Palette {
  const dir = t === 'dark' ? 'lighter' : 'darker';
  const canvas = b.canvasY >= 1 ? '#ffffff' : hY(b.neutralHue, b.neutralChroma, b.canvasY);
  const surface = step(canvas, b.step, b.neutralHue, b.neutralChroma, dir);
  const surfaceRaised = step(surface, b.step, b.neutralHue, b.neutralChroma, dir);
  const surfaceOverlay = step(surfaceRaised, b.step, b.neutralHue, b.neutralChroma, dir);
  const ink = hY(b.neutralHue, b.neutralChroma * 0.6, b.inkY);
  const hardest = t === 'dark' ? surfaceOverlay : surfaceOverlay;
  const inkMuted =
    t === 'dark'
      ? hY(b.neutralHue, b.neutralChroma, above(hardest, 4.85))
      : hY(b.neutralHue, b.neutralChroma, below(hardest, 4.85));
  const border =
    t === 'dark'
      ? hY(b.neutralHue, b.neutralChroma, above(hardest, 3.3))
      : hY(b.neutralHue, b.neutralChroma, below(hardest, 3.3));
  return { canvas, surface, surfaceRaised, surfaceOverlay, ink, inkMuted, border };
}

function illo(t: Theme, n: Palette, opts: { skyH: number; hillH: number; roadH: number; sunH: number }, focus: string): Palette {
  if (t === 'dark') {
    const illoSky = hY(opts.skyH, 0.05, 0.016);
    const illoHillFar = step(illoSky, 1.32, opts.hillH, 0.05, 'lighter');
    const illoHillNear = step(illoHillFar, 1.32, opts.hillH, 0.07, 'lighter');
    const illoRoad = step(illoHillNear, 1.3, opts.roadH, 0.012, 'lighter');
    const illoSun = hY(opts.sunH, 0.1, Math.min(0.2, below(focus, 3.3)));
    return { illoSky, illoSun, illoHillFar, illoHillNear, illoRoad };
  }
  const illoSky = hY(opts.skyH, 0.04, Math.max(0.68, above(n.inkMuted!, 4.9)));
  const illoHillFar = step(illoSky, 1.22, opts.hillH, 0.06, 'darker');
  const illoHillNear = step(illoHillFar, 1.3, opts.hillH, 0.08, 'darker');
  const illoRoad = step(illoHillNear, 1.3, opts.roadH, 0.01, 'darker');
  const illoSun = hY(opts.sunH, 0.14, 0.55);
  return { illoSky, illoSun, illoHillFar, illoHillNear, illoRoad };
}

// Option A: graphite and a fluorescent yellow-green.
const A: Option = {
  id: 'A',
  name: 'Hi-Vis',
  accentSource:
    'The fluorescent yellow-green of high-visibility cycling clothing (the background material class of EN ISO 20471), moved toward green in sRGB so it reads as lime, not as yellow.',
  hud: {
    hudSurface: hY(250, 0.006, 0.006),
    hudInk: hY(250, 0.004, 0.92),
    hudInkMuted: hY(250, 0.01, 0.36),
    hudBorder: hY(250, 0.01, 0.2),
    hudStaleInk: hY(75, 0.14, 0.5),
  },
  build(t) {
    const LIME = 128;
    const n = neutrals(t, t === 'dark'
      ? { neutralHue: 250, neutralChroma: 0.006, canvasY: 0.0062, step: 1.24, inkY: 0.86 }
      : { neutralHue: 250, neutralChroma: 0.004, canvasY: 1, step: 1.155, inkY: 0.007 });
    const p: Palette = { ...n };
    if (t === 'dark') {
      p.accent = hY(LIME, 0.21, 0.72);
      p.accentHover = hY(LIME, 0.17, 0.84);
      p.accentInk = hY(LIME, 0.03, 0.008);
      p.selected = hY(LIME, 0.07, 0.045);
      p.link = hY(LIME, 0.17, 0.62);
      p.linkVisited = hY(300, 0.1, 0.48);
      p.linkHover = hY(LIME, 0.12, 0.8);
      p.linkActive = hY(LIME, 0.06, 0.9);
      p.focus = hY(LIME, 0.21, 0.72);
    } else {
      p.accent = hY(LIME, 0.14, 0.09);
      p.accentHover = hY(LIME, 0.11, 0.045);
      p.accentInk = '#ffffff';
      p.selected = hY(LIME, 0.12, 0.8);
      p.link = hY(LIME, 0.14, 0.085);
      p.linkVisited = hY(300, 0.14, 0.075);
      p.linkHover = hY(LIME, 0.11, 0.045);
      p.linkActive = hY(LIME, 0.07, 0.02);
      p.focus = n.ink;
    }
    Object.assign(p, status(t, n.canvas, p));
    Object.assign(p, illo(t, n, { skyH: 255, hillH: 140, roadH: 250, sunH: 95 }, p.focus!));
    Object.assign(p, zones(t, n.surface, 0.15));
    return p;
  },
};

// Option B: deep blue-black and an indigo-violet.
const B: Option = {
  id: 'B',
  name: 'Blue Hour',
  accentSource:
    'The indigo of the sky in the half hour after sunset (the "blue hour" of an evening ride), taken toward violet so that it is not any product\'s blue.',
  hud: {
    hudSurface: hY(270, 0.03, 0.007),
    hudInk: hY(270, 0.01, 0.9),
    hudInkMuted: hY(270, 0.03, 0.38),
    hudBorder: hY(270, 0.04, 0.2),
    hudStaleInk: hY(75, 0.14, 0.5),
  },
  build(t) {
    const VIO = 285;
    const n = neutrals(t, t === 'dark'
      ? { neutralHue: 272, neutralChroma: 0.03, canvasY: 0.007, step: 1.27, inkY: 0.84 }
      : { neutralHue: 272, neutralChroma: 0.012, canvasY: 0.96, step: 1.15, inkY: 0.008 });
    const p: Palette = { ...n };
    if (t === 'dark') {
      p.accent = hY(VIO, 0.2, 0.52);
      p.accentHover = hY(VIO, 0.14, 0.64);
      p.accentInk = hY(VIO, 0.06, 0.006);
      p.selected = hY(VIO, 0.09, 0.04);
      p.link = hY(VIO, 0.2, 0.52);
      p.linkVisited = hY(330, 0.12, 0.52);
      p.linkHover = hY(VIO, 0.1, 0.66);
      p.linkActive = hY(VIO, 0.05, 0.78);
      p.focus = hY(VIO, 0.02, 0.84);
    } else {
      p.accent = hY(VIO, 0.2, 0.075);
      p.accentHover = hY(VIO, 0.17, 0.04);
      p.accentInk = '#ffffff';
      p.selected = hY(VIO, 0.06, 0.74);
      p.link = hY(VIO, 0.2, 0.075);
      p.linkVisited = hY(330, 0.15, 0.07);
      p.linkHover = hY(VIO, 0.17, 0.04);
      p.linkActive = hY(VIO, 0.1, 0.018);
      p.focus = n.ink;
    }
    Object.assign(p, status(t, n.canvas, p));
    Object.assign(p, illo(t, n, { skyH: 280, hillH: 290, roadH: 270, sunH: 70 }, p.focus!));
    Object.assign(p, zones(t, n.surface, 0.15));
    return p;
  },
};

// Option C: monochrome; colour is spent only on zones and status.
const C: Option = {
  id: 'C',
  name: 'Monochrome + Zones',
  accentSource:
    'No hue at all: the accent is the ink itself (white on black, black on white). Colour is spent only on power zones and status, so a zone is the brightest thing on any screen.',
  hud: {
    hudSurface: hY(60, 0.0, 0.004),
    hudInk: '#ffffff',
    hudInkMuted: hY(60, 0.0, 0.38),
    hudBorder: hY(60, 0.0, 0.2),
    hudStaleInk: hY(75, 0.14, 0.5),
  },
  build(t) {
    const n = neutrals(t, t === 'dark'
      ? { neutralHue: 60, neutralChroma: 0.004, canvasY: 0.0, step: 1.2, inkY: 0.9 }
      : { neutralHue: 60, neutralChroma: 0.004, canvasY: 1, step: 1.15, inkY: 0.004 });
    const p: Palette = { ...n };
    if (t === 'dark') {
      p.accent = hY(60, 0.0, 0.92);
      p.accentHover = '#ffffff';
      p.accentInk = n.canvas;
      p.selected = hY(60, 0.004, 0.11);
      p.link = hY(60, 0.0, 0.92);
      p.linkVisited = hY(300, 0.06, 0.5);
      p.linkHover = '#ffffff';
      p.linkActive = hY(60, 0.0, 0.7);
      p.focus = '#ffffff';
    } else {
      p.accent = hY(60, 0.0, 0.006);
      p.accentHover = '#000000';
      p.accentInk = '#ffffff';
      p.selected = hY(60, 0.004, 0.62);
      p.link = hY(60, 0.0, 0.006);
      p.linkVisited = hY(300, 0.12, 0.05);
      p.linkHover = '#000000';
      p.linkActive = hY(60, 0.0, 0.03);
      p.focus = '#000000';
    }
    Object.assign(p, status(t, n.canvas, p));
    Object.assign(p, illo(t, n, { skyH: 250, hillH: 60, roadH: 60, sunH: 85 }, p.focus!));
    Object.assign(p, zones(t, n.surface, 0.19));
    return p;
  },
};

const OPTIONS = [A, B, C];

// ---------- evaluation ----------
const seen = new Set<string>();
const pairs = (dump.req as { f: string; b: string; min: number; where: string }[]).filter((r) => {
  const k = `${r.f}|${r.b}|${r.min}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
const ELEV = ['canvas', 'surface', 'surfaceRaised', 'surfaceOverlay'];
const out: Record<string, unknown> = {};
const fmt = (n: number) => n.toFixed(2);
let report = '';
let failures = 0;
for (const o of OPTIONS) {
  const themes = { dark: { ...o.build('dark'), ...o.hud }, light: { ...o.build('light'), ...o.hud } };
  const rows = pairs.map((r) => {
    const d = contrastRatio(themes.dark[r.f]!, themes.dark[r.b]!);
    const l = contrastRatio(themes.light[r.f]!, themes.light[r.b]!);
    if (d < r.min || l < r.min) failures++;
    return { ...r, dark: d, light: l };
  });
  const numerals = [
    { f: 'ink', b: 'surfaceRaised', where: 'a primary metric numeral on a metric card' },
    { f: 'ink', b: 'surface', where: 'a primary metric numeral on a panel' },
    { f: 'hudInk', b: 'hudSurface', where: 'a primary metric numeral on a HUD panel' },
  ].map((r) => ({
    ...r,
    min: 7,
    dark: contrastRatio(themes.dark[r.f]!, themes.dark[r.b]!),
    light: contrastRatio(themes.light[r.f]!, themes.light[r.b]!),
  }));
  const elevation = (['dark', 'light'] as const).map((t) => ({
    theme: t,
    steps: ELEV.slice(1).map((tok, i) => ({
      from: ELEV[i],
      to: tok,
      ratio: contrastRatio(themes[t][ELEV[i]!]!, themes[t][tok]!),
    })),
    raisedOnCanvas: contrastRatio(themes[t].canvas!, themes[t].surfaceRaised!),
  }));
  const zoneRows = (['dark', 'light'] as const).map((t) => {
    const cols = ['normal', 'deuteranopia', 'protanopia', 'tritanopia'].map((kind) => {
      const colours = ZONES.map(([tok]) => (kind === 'normal' ? themes[t][tok]! : simulate(themes[t][tok]!, kind)));
      return {
        kind,
        colours,
        adjacent: colours.slice(1).map((c, i) => contrastRatio(colours[i]!, c)),
        onSurface: colours.map((c) => contrastRatio(c, themes[t].surface!)),
      };
    });
    return { theme: t, cols };
  });
  out[o.id] = { name: o.name, accentSource: o.accentSource, themes, rows, numerals, elevation, zones: zoneRows };

  report += `\n## Option ${o.id}: ${o.name}\n`;
  for (const e of elevation) report += `${e.theme} steps ${e.steps.map((s) => fmt(s.ratio)).join(' / ')} raised-on-canvas ${fmt(e.raisedOnCanvas)}\n`;
  for (const r of numerals) report += `numeral ${r.f}/${r.b} dark ${fmt(r.dark)} light ${fmt(r.light)}\n`;
  const bad = rows.filter((r) => r.dark < r.min || r.light < r.min);
  report += `pairs ${rows.length}, failing ${bad.length}: ${bad.map((r) => `${r.f}/${r.b} d${fmt(r.dark)} l${fmt(r.light)} min${r.min}`).join('; ')}\n`;
  const lowest = (t: 'dark' | 'light') => rows.reduce((m, r) => Math.min(m, r[t] / r.min), 99);
  report += `lowest headroom dark ${fmt(lowest('dark'))} light ${fmt(lowest('light'))}\n`;
  for (const z of zoneRows)
    for (const c of z.cols) report += `zones ${z.theme} ${c.kind.padEnd(12)} ${c.colours.join(' ')} adj ${c.adjacent.map(fmt).join(' ')} onSurf ${c.onSurface.map(fmt).join(' ')}\n`;
  for (const t of ['dark', 'light'] as const) report += `${t}: ${JSON.stringify(themes[t])}\n`;
}
writeFileSync(here + 'options.json', JSON.stringify(out, null, 1));
writeFileSync(here + 'report.txt', report);
console.log(report.split('\n').filter((l) => !l.startsWith('dark:') && !l.startsWith('light:')).join('\n'));
console.log('total failing pair-rows', failures);
