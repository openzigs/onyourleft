// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2035 — THROWAWAY design-direction prototype. Never merged.
 *
 * Renders one option's tokens through the shipping `theme.css`: every
 * `--oyl-color-*` custom property the product paints with is overridden from
 * `options.json` (written by `gen.ts`, whose contrast numbers come from the
 * product's own `src/design/contrast.ts`). Synthetic data only.
 *
 *   ?option=A|B|C &theme=dark|light &view=home|board|hud
 */

import { StrictMode, type CSSProperties, type JSX, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import '../../src/design/theme.css';
import './harness.css';
import { Button } from '../../src/design/Button';
import OPTIONS from './options.json';

type Theme = 'dark' | 'light';
type Palette = Record<string, string>;
interface Option {
  name: string;
  accentSource: string;
  themes: Record<Theme, Palette>;
  elevation: { theme: Theme; steps: { from: string; to: string; ratio: number }[]; raisedOnCanvas: number }[];
  zones: { theme: Theme; cols: { kind: string; colours: string[]; adjacent: number[]; onSurface: number[] }[] }[];
  rows: { f: string; b: string; min: number; where: string; dark: number; light: number }[];
  numerals: { f: string; b: string; min: number; where: string; dark: number; light: number }[];
}
const ALL = OPTIONS as unknown as Record<string, Option>;

/** Shape and type: what the tokens alone do not say. */
interface Style {
  radius: string;
  radiusCard: string;
  addedWeight: 500 | 600;
  ratio: number;
  /** [rem, weight] */
  display: [number, number];
  h1: [number, number];
  h2: [number, number];
  h3: [number, number];
  body: [number, number];
  label: [number, number];
  tile: [number, number];
  secondary: [number, number];
  primary: [number, number];
  hudCaps: boolean;
  cardEdge: 'border' | 'none';
}
export const STYLE: Record<string, Style> = {
  A: {
    radius: '0.25rem',
    radiusCard: '0.375rem',
    addedWeight: 600,
    ratio: 1.25,
    display: [2.441, 800],
    h1: [1.953, 800],
    h2: [1.563, 700],
    h3: [1.25, 600],
    body: [1, 400],
    label: [0.8, 600],
    tile: [1.953, 700],
    secondary: [2.441, 700],
    primary: [3.815, 700],
    hudCaps: true,
    cardEdge: 'none',
  },
  B: {
    radius: '0.75rem',
    radiusCard: '1.25rem',
    addedWeight: 500,
    ratio: 1.2,
    display: [2.074, 800],
    h1: [1.728, 800],
    h2: [1.44, 700],
    h3: [1.2, 700],
    body: [1, 400],
    label: [0.833, 500],
    tile: [2.074, 500],
    secondary: [2.488, 500],
    primary: [4.3, 500],
    hudCaps: false,
    cardEdge: 'none',
  },
  C: {
    radius: '0.5rem',
    radiusCard: '0.5rem',
    addedWeight: 600,
    ratio: 1.333,
    display: [3.157, 800],
    h1: [2.369, 800],
    h2: [1.777, 700],
    h3: [1.333, 600],
    body: [1, 400],
    label: [0.75, 600],
    tile: [2.369, 800],
    secondary: [3.157, 700],
    primary: [5.61, 800],
    hudCaps: false,
    cardEdge: 'border',
  },
};

const ZONES = ['bandRecovery', 'bandEndurance', 'bandTempo', 'bandThreshold', 'bandVo2', 'bandAnaerobic', 'bandSprint'];
const ZONE_NAMES = ['Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO₂', 'Anaerobic', 'Sprint'];

const kebab = (k: string) => k.replace(/([A-Z])/g, '-$1').toLowerCase();
function vars(p: Palette, s: Style): CSSProperties {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) out[`--oyl-color-${kebab(k)}`] = v;
  out['--oyl-radius'] = s.radius;
  out['--oyl-radius-card'] = s.radiusCard;
  const t = (name: string, [rem, w]: [number, number]) => {
    out[`--d-${name}-size`] = `${rem}rem`;
    out[`--d-${name}-weight`] = String(w);
  };
  t('display', s.display);
  t('h1', s.h1);
  t('h2', s.h2);
  t('h3', s.h3);
  t('body', s.body);
  t('label', s.label);
  t('tile', s.tile);
  t('secondary', s.secondary);
  t('primary', s.primary);
  out['--d-card-edge'] = s.cardEdge === 'border' ? '1px solid var(--oyl-color-border)' : '0';
  out['--d-hud-label-transform'] = s.hudCaps ? 'uppercase' : 'none';
  return out as CSSProperties;
}

const params = new URLSearchParams(location.search);
const optionId = params.get('option') ?? 'A';
const theme = (params.get('theme') ?? 'dark') as Theme;
const view = params.get('view') ?? 'home';
const option = ALL[optionId]!;
const style = STYLE[optionId]!;

// ---------------------------------------------------------------- pieces

function Num({ children, unit, size = 'tile' }: { children: ReactNode; unit?: string; size?: 'tile' | 'secondary' | 'primary' }): JSX.Element {
  return (
    <span className={`d-num d-num--${size}`}>
      {children}
      {unit ? <span className="d-num__unit">{unit}</span> : null}
    </span>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }): JSX.Element {
  return (
    <div className="d-metric">
      <span className="d-label">{label}</span>
      <Num unit={unit}>{value}</Num>
    </div>
  );
}

function ZoneSwatch({ i, compact = false }: { i: number; compact?: boolean }): JSX.Element {
  return (
    <span className={`d-zone ${compact ? 'd-zone--compact' : ''}`}>
      <span className="d-zone__chip" style={{ background: `var(--oyl-color-${kebab(ZONES[i]!)})` }} aria-hidden="true" />
      <span className="d-zone__num">{i + 1}</span>
      <span className="d-zone__name">{ZONE_NAMES[i]}</span>
    </span>
  );
}

function StatusDot({ on }: { on: boolean }): JSX.Element {
  return (
    <svg className={`d-dot ${on ? 'd-dot--on' : ''}`} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function Header({ phone }: { phone: boolean }): JSX.Element {
  return (
    <header className="d-header">
      <span className="d-wordmark">On Your Left</span>
      {phone ? null : (
        <nav className="d-nav" aria-label="Main">
          {['Home', 'Ride', 'Routes', 'Activities', 'Analysis', 'Devices', 'Settings'].map((n) => (
            <a key={n} href="#" className={n === 'Home' ? 'd-nav__item d-nav__item--current' : 'd-nav__item'}>
              {n}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}

function BottomBar(): JSX.Element {
  return (
    <nav className="d-bottom" aria-label="Main">
      {['Home', 'Ride', 'Routes', 'Activities', 'More'].map((n) => (
        <a key={n} href="#" className={n === 'Home' ? 'd-bottom__item d-bottom__item--current' : 'd-bottom__item'}>
          <span className="d-bottom__icon" aria-hidden="true" />
          {n}
        </a>
      ))}
    </nav>
  );
}

function QuickLaunch(): JSX.Element {
  return (
    <section className="d-card d-quick" aria-labelledby="q">
      <h2 id="q" className="d-h2">
        Ride
      </h2>
      <p className="d-muted">Trainer connected. ERG is ready.</p>
      <div className="d-quick__go">
        <Button className="oyl-button--ride d-go" onClick={() => {}}>
          Start a free ride
        </Button>
      </div>
      <div className="d-quick__more">
        <span className="d-label d-quick__or">Or pick up where you left off</span>
        <Button variant="secondary" onClick={() => {}}>
          Workout: Sweet spot 3 × 10
        </Button>
        <Button variant="secondary" onClick={() => {}}>
          Route: River loop, 24.6 km
        </Button>
      </div>
    </section>
  );
}

function Sensors(): JSX.Element {
  const rows: [string, boolean, string][] = [
    ['Smart trainer', true, 'Battery n/a'],
    ['Power meter', true, 'Battery 82 %'],
    ['Heart rate', false, 'Not found yet'],
    ['Cadence', true, 'Battery 64 %'],
  ];
  return (
    <section className="d-card d-sensors" aria-labelledby="s">
      <div className="d-card__head">
        <h2 id="s" className="d-h2">
          Sensors
        </h2>
        <Button variant="tertiary" onClick={() => {}}>
          Devices
        </Button>
      </div>
      <ul className="d-sensors__list">
        {rows.map(([name, on, extra]) => (
          <li key={name} className="d-sensor">
            <span className={on ? 'd-sensor__state d-sensor__state--on' : 'd-sensor__state'}>
              <StatusDot on={on} />
            </span>
            <span className="d-sensor__name">{name}</span>
            <span className={on ? 'd-sensor__word d-sensor__word--on' : 'd-sensor__word'}>{on ? 'Connected' : 'Not connected'}</span>
            <span className="d-sensor__extra">{extra}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const PROFILE = [12, 14, 18, 26, 31, 29, 22, 20, 24, 35, 47, 52, 49, 40, 33, 30, 28, 34, 41, 38, 30, 22, 18, 16, 15];
function Profile(): JSX.Element {
  const w = 600;
  const h = 90;
  const max = 60;
  const pts = PROFILE.map((v, i) => `${((i / (PROFILE.length - 1)) * w).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`);
  return (
    <svg className="d-profile" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Elevation profile, 512 m climbed">
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} className="d-profile__fill" />
      <polyline points={pts.join(' ')} className="d-profile__line" fill="none" />
    </svg>
  );
}

const TIME_IN_ZONE = [9, 38, 21, 18, 8, 4, 2];
function LastRide(): JSX.Element {
  return (
    <section className="d-card d-last" aria-labelledby="l">
      <div className="d-card__head">
        <h2 id="l" className="d-h2">
          Last ride
        </h2>
        <span className="d-muted">River loop · Sat 1 Nov</span>
      </div>
      <div className="d-metrics">
        <Metric label="Distance" value="42.3" unit="km" />
        <Metric label="Moving time" value="1:28:12" />
        <Metric label="Average power" value="186" unit="W" />
        <Metric label="Climbed" value="512" unit="m" />
      </div>
      <Profile />
      <div className="d-tiz" role="img" aria-label="Time in zone">
        {TIME_IN_ZONE.map((p, i) => (
          <span key={i} style={{ flexGrow: p, background: `var(--oyl-color-${kebab(ZONES[i]!)})` }} />
        ))}
      </div>
      <ul className="d-tiz__legend">
        {TIME_IN_ZONE.map((p, i) => (
          <li key={i}>
            <ZoneSwatch i={i} compact />
            <span className="d-tiz__pc">{p} %</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const WEEK: [string, number][] = [
  ['Mon', 0],
  ['Tue', 62],
  ['Wed', 0],
  ['Thu', 45],
  ['Fri', 0],
  ['Sat', 88],
  ['Sun', 57],
];
function Week(): JSX.Element {
  const max = 100;
  return (
    <section className="d-card d-week" aria-labelledby="w">
      <h2 id="w" className="d-h2">
        This week
      </h2>
      <div className="d-metrics d-metrics--three">
        <Metric label="Rides" value="4" />
        <Metric label="Time" value="4:12" unit="h" />
        <Metric label="Distance" value="118" unit="km" />
      </div>
      <svg className="d-bars" viewBox="0 0 350 150" role="img" aria-label="Minutes ridden each day this week">
        {WEEK.map(([d, m], i) => {
          const x = 10 + i * 48;
          const bh = (m / max) * 100;
          return (
            <g key={d}>
              <rect x={x} y={20} width={34} height={100} className="d-bars__well" rx={3} />
              {m > 0 ? <rect x={x} y={120 - bh} width={34} height={bh} className="d-bars__bar" rx={3} /> : null}
              <text x={x + 17} y={140} className="d-bars__day" textAnchor="middle">
                {d}
              </text>
              <text x={x + 17} y={m > 0 ? 114 - bh : 114} className="d-bars__val" textAnchor="middle">
                {m > 0 ? m : '–'}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}

function Home(): JSX.Element {
  const phone = innerWidth < 700;
  return (
    <div className={`d-app ${phone ? 'd-app--phone' : 'd-app--tablet'}`}>
      <Header phone={phone} />
      <main className="d-home">
        <QuickLaunch />
        <Sensors />
        <LastRide />
        <Week />
      </main>
      {phone ? <BottomBar /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- HUD

function HudPanel({ children, className = '' }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={`d-hud__panel ${className}`}>{children}</div>;
}
function HudReading({ label, value, unit, size = 'secondary' }: { label: string; value: string; unit?: string; size?: 'secondary' | 'primary' }): JSX.Element {
  return (
    <div className="d-hud__reading">
      <span className="d-hud__label">{label}</span>
      <Num unit={unit} size={size}>
        {value}
      </Num>
    </div>
  );
}
const PLAN = [1, 2, 2, 3, 4, 4, 4, 2, 4, 4, 4, 2, 5, 6, 7, 1];
function Hud(): JSX.Element {
  return (
    <div className="d-hud">
      <div className="d-hud__world" aria-hidden="true">
        <div className="d-hud__road" />
      </div>
      <HudPanel className="d-hud__power">
        <HudReading label="Power" value="248" unit="W" size="primary" />
        <div className="d-hud__zone">
          <ZoneSwatch i={3} />
        </div>
        <div className="d-hud__target">Target 245 W · 3:12 left</div>
      </HudPanel>
      <HudPanel className="d-hud__clock">
        <HudReading label="Elapsed" value="0:42:17" />
        <HudReading label="Distance" value="18.4" unit="km" />
      </HudPanel>
      <HudPanel className="d-hud__row">
        <HudReading label="Cadence" value="92" unit="rpm" />
        <HudReading label="Heart rate" value="151" unit="bpm" />
        <HudReading label="Speed" value="34.2" unit="km/h" />
      </HudPanel>
      <HudPanel className="d-hud__plan">
        <div className="d-hud__trace">
          {PLAN.map((z, i) => (
            <span key={i} className={i === 5 ? 'd-hud__step d-hud__step--now' : 'd-hud__step'} style={{ height: `${z * 14}%`, background: `var(--oyl-color-${kebab(ZONES[z - 1]!)})` }} />
          ))}
        </div>
        <div className="d-hud__legend">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <ZoneSwatch key={i} i={i} compact />
          ))}
        </div>
      </HudPanel>
      <div className="d-hud__actions">
        <button className="d-hud__btn" type="button">
          Pause
        </button>
        <button className="d-hud__btn" type="button">
          End ride
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- board

const SWATCHES: [string, string[]][] = [
  ['Surfaces', ['canvas', 'surface', 'surfaceRaised', 'surfaceOverlay']],
  ['Ink', ['ink', 'inkMuted', 'border', 'focus']],
  ['Accent', ['accent', 'accentHover', 'accentInk', 'selected']],
  ['Status', ['successInk', 'warningInk', 'dangerInk', 'dangerAction']],
  ['Illustration', ['illoSky', 'illoSun', 'illoHillFar', 'illoHillNear', 'illoRoad']],
  ['HUD', ['hudSurface', 'hudInk', 'hudInkMuted', 'hudBorder']],
];

function Swatches({ p }: { p: Palette }): JSX.Element {
  return (
    <div className="d-sw">
      {SWATCHES.map(([group, toks]) => (
        <div key={group} className="d-sw__group">
          <span className="d-label">{group}</span>
          <div className="d-sw__row">
            {toks.map((t) => (
              <div key={t} className="d-sw__item">
                <span className="d-sw__chip" style={{ background: p[t] }} />
                <span className="d-sw__name">{t}</span>
                <span className="d-sw__hex">{p[t]}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ZoneBoard({ t }: { t: Theme }): JSX.Element {
  const z = option.zones.find((x) => x.theme === t)!;
  return (
    <div className="d-zb">
      {z.cols.map((c) => (
        <div key={c.kind} className="d-zb__row">
          <span className="d-zb__kind">{c.kind}</span>
          {c.colours.map((col, i) => (
            <span key={i} className="d-zb__cell">
              <span className="d-zb__chip" style={{ background: col }} />
              <span className="d-zone__num">{i + 1}</span>
              <span className="d-zone__name">{ZONE_NAMES[i]}</span>
              {i > 0 ? <span className="d-zb__ratio">{c.adjacent[i - 1]!.toFixed(2)}:1</span> : <span className="d-zb__ratio" />}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Components(): JSX.Element {
  return (
    <div className="d-comp">
      <div className="d-comp__buttons">
        <Button onClick={() => {}}>Primary</Button>
        <Button variant="secondary" onClick={() => {}}>
          Secondary
        </Button>
        <Button variant="tertiary" onClick={() => {}}>
          Tertiary
        </Button>
        <Button variant="danger" onClick={() => {}}>
          Delete ride
        </Button>
      </div>
      <section className="d-card d-comp__card">
        <h3 className="d-h3">A card on canvas</h3>
        <p className="d-muted">Panel level 1, metric tiles at level 2.</p>
        <div className="d-metrics d-metrics--two">
          <Metric label="Average power" value="186" unit="W" />
          <Metric label="Distance" value="42.3" unit="km" />
        </div>
      </section>
      <div className="d-hud__panel d-comp__hud">
        <HudReading label="Power" value="248" unit="W" size="primary" />
        <ZoneSwatch i={3} />
      </div>
    </div>
  );
}

function Board(): JSX.Element {
  const s = style;
  const type: [string, [number, number], string, string][] = [
    ['Display', s.display, 'Barlow', 'Ride on'],
    ['Heading 1', s.h1, 'Barlow', 'Your week'],
    ['Heading 2', s.h2, 'Barlow', 'Last ride'],
    ['Heading 3', s.h3, 'Barlow', 'Sensors'],
    ['Body', s.body, 'system-ui', 'The trainer is connected and ERG is ready.'],
    ['Label', s.label, 'Barlow', 'Average power'],
    ['Home numeral', s.tile, 'Barlow tnum', '1:28:12'],
    ['HUD secondary', s.secondary, 'Barlow tnum', '0:42:17'],
    ['HUD primary', s.primary, 'Barlow tnum', '248'],
  ];
  return (
    <div className="d-board">
      <h1 className="d-display">
        Option {optionId}: {option.name}
      </h1>
      <p className="d-board__src">Accent: {option.accentSource}</p>
      <div className="d-board__themes">
        {(['dark', 'light'] as const).map((t) => (
          <section key={t} className="d-board__theme" style={vars({ ...option.themes[t] }, s)} data-board-theme={t}>
            <h2 className="d-h2">{t === 'dark' ? 'Dark (default)' : 'Light'}</h2>
            <Swatches p={option.themes[t]} />
            <h3 className="d-h3">Surface levels</h3>
            <div className="d-elev">
              {['canvas', 'surface', 'surfaceRaised', 'surfaceOverlay'].map((tok, i) => (
                <div key={tok} className="d-elev__lvl" style={{ background: option.themes[t][tok] }}>
                  <span>
                    {i} {tok}
                  </span>
                  {i > 0 ? <strong>{option.elevation.find((e) => e.theme === t)!.steps[i - 1]!.ratio.toFixed(2)}:1</strong> : null}
                </div>
              ))}
            </div>
            <h3 className="d-h3">Zones, and under simulated colour-vision deficiency (adjacent ratio)</h3>
            <ZoneBoard t={t} />
            <h3 className="d-h3">Button, card, HUD panel</h3>
            <Components />
          </section>
        ))}
      </div>
      <section className="d-board__type" style={vars(option.themes.dark, s)}>
        <h2 className="d-h2">
          Type scale: ratio {s.ratio}, Barlow {s.addedWeight} added
        </h2>
        {type.map(([n, [rem, w], fam, sample]) => (
          <div key={n} className="d-type">
            <span className="d-type__meta">
              {n} · {rem}rem / {Math.round(rem * 16)}px · {w} · {fam}
            </span>
            <span
              style={{
                fontSize: `${rem}rem`,
                fontWeight: w,
                fontFamily: fam.startsWith('Barlow') ? "'Barlow', system-ui" : 'system-ui',
                fontVariantNumeric: fam.endsWith('tnum') ? 'tabular-nums' : undefined,
              }}
            >
              {sample}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- mount

document.documentElement.dataset.theme = view === 'hud' ? 'dark' : theme;
document.documentElement.dataset.option = optionId;
const rootVars = vars(option.themes[view === 'hud' ? 'dark' : theme], style);
for (const [k, v] of Object.entries(rootVars)) document.documentElement.style.setProperty(k, String(v));
document.documentElement.style.colorScheme = view === 'hud' ? 'dark' : theme;

createRoot(document.getElementById('root')!).render(
  <StrictMode>{view === 'board' ? <Board /> : view === 'hud' ? <Hud /> : <Home />}</StrictMode>,
);
document.fonts.ready.then(() => {
  (window as unknown as { __ready: boolean }).__ready = true;
});
