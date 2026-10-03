// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a rider says whether they ride in kilometres or in miles (#238), and
 * what they weigh (#325).
 *
 * ## Why this is its own screen
 *
 * It changes what **every** other screen says, so it belongs to none of them.
 * The thresholds on the analysis screen are inputs to the numbers beside them
 * and are rightly there; this is not — a rider looking for "how do I get
 * miles" would not think to look under Analysis, and a preference that is hard
 * to find is one that gets reported as a missing feature.
 *
 * It is also a route, which means the accessibility gate reaches it without
 * anyone remembering to add a case: `routes.a11y.test.tsx` iterates the table
 * in `shell/routes.ts`.
 *
 * ## Why the weight is here and not on the game screen
 *
 * #325's sixth acceptance criterion is that there *be* a way for a rider to
 * enter their mass. The physics reads it, so the game is where its effect is
 * felt — and a setting belongs where a rider would look for it rather than
 * where it is consumed, which is the same argument this file already makes
 * about units against the thresholds on the analysis screen. It is also the
 * screen that already knows which units the rider reads in, and a weight is the
 * fourth quantity ADR 0020 D-1 put inside that switch.
 *
 * ⚠️ **Two ports, not one.** `athlete/store-port.ts` says why: a display
 * preference and an input to the physics are not the same kind of thing, and a
 * screen offering one is not thereby entitled to the other.
 *
 * ⚠️ **The route being in the table is not enough, and a review caught this.**
 * With no `settings` port the shell renders {@link UNITS_NO_STORE} — a
 * paragraph with nothing interactive in it — so the gate audited a route on
 * which the radio group had never rendered, and reported it clean. What makes
 * the control audited is `routes.a11y.test.tsx` §`settingsPort`, which hands
 * the shell a port that answers. Removing it turns a control with no
 * accessible name back into a green run.
 *
 * ## The current choice is visible, never implied
 *
 * #238 is explicit that the default must not be a silent guess from the
 * locale. So the control is a radio group whose selected option *is* the
 * current setting, each option names the units it means in the words a rider
 * would use, and the panel says what the choice does and does not affect. A
 * rider who has never chosen sees `metric` selected and can see that it is
 * selected, which is the difference between a default and a guess.
 *
 * ## What it changes, and what it does not
 *
 * The write is one call on {@link UnitsPort}, and it lands on the athlete row
 * (ADR 0020 D-2). Nothing else in the database moves: the conversion happens
 * at the formatting boundary and `packages/store`'s
 * `activity-store.units.test.ts` reads a ride back either side of a change to
 * prove it. An exported FIT, GPX or TCX file is likewise unaffected, and the
 * panel says so — a rider about to send a file to a coach should not have to
 * guess.
 */

import { useState, type JSX, type ReactNode } from 'react';

import { kilograms, type Kilograms } from '@onyourleft/domain';
import {
  KIT_COLOURS,
  parseKitColour,
  UNIT_SYSTEMS,
  type KitColour,
  type UnitSystem,
} from '@onyourleft/store';

import { DEFAULT_RIDER_MASS_KILOGRAMS, massToSave, riderMassFor } from '../athlete/mass';
import type { AthleteKitColourPort } from '../athlete/kit-colour-port';
import { MASKED_WORDS_LEAD, MaskedWordsPanel } from '../athlete/MaskedWordsPanel';
import type { MaskedWordsPort } from '../athlete/masked-words-port';
import { GOALS_KEY, MAXIMUM_GOALS_CHARACTERS } from '@onyourleft/store';
import { RIDER_TEXT_KEPT_VISIBLE } from '../rider-text/disclosure';
import { DocumentsPanel } from '../rider-text/DocumentsPanel';
import { RiderTextBox } from '../rider-text/RiderTextBox';
import type { RiderTextPort } from '../rider-text/rider-text-port';
import { GOALS_WORDS } from '../rider-text/words';
import type { AthleteMassPort } from '../athlete/store-port';
import { Button } from '../design/Button';
// The parts' own files, not the kit's index: the index names every part, and
// a part these cards do not draw is not this screen's to pull into a bundle.
import { Hills } from '../design/illustration/Hills';
import { RoadRibbon } from '../design/illustration/RoadRibbon';
import { Sky } from '../design/illustration/Sky';
import { KeptVisible, MoreAbout } from '../design/MoreAbout';
import {
  THEME_CHOICES,
  chooseTheme,
  currentThemeChoice,
  deviceThemeStorage,
  type ThemeChoice,
  type ThemeStorage,
} from '../design/theme-selection';
import { StatusMessage } from '../design/StatusMessage';
import { Stepper } from '../design/Stepper';
import { CLEARING_STILL_REMOVES, PersistenceNotice } from '../support/PersistenceNotice';
import type { StorageManagerLike } from '../support/persistent-storage';
import { hrefFor, routeById } from '../shell/routes';
import {
  distanceUnit,
  formatMass,
  formatSmallDistance,
  massIn,
  massUnit,
  measurementText,
} from '../units/format';
import {
  DISTANCE_EVERY_CHOICES,
  CLIMB_LEAD_CHOICES,
  INTERVAL_LEAD_CHOICES,
  POWER_EVERY_CHOICES,
  deviceStorage,
  readAnnouncementPreference,
  writeAnnouncementPreference,
  type AnnouncementPreference,
  type Every,
  type PreferenceStorage,
} from '../game/hud/announce-preference';
import {
  readCuePreference,
  steppedVolume,
  writeCuePreference,
  type CuePreference,
} from '../game/cue-preference';
import type { UnitsPort } from '../units/store-port';
import { readRealisticWorldChoice, writeRealisticWorldChoice } from '../game/world-preference';
import { KIT_PALETTE } from '../game/bicycle';
import { PUBLISHED_BASEMAP_URL, type BasemapConfig } from '../map/basemap';
import { readMapTilesChoice, writeMapTilesChoice } from '../map/tiles-preference';

/**
 * What a panel is currently telling the rider, or `undefined` for nothing.
 *
 * Named because it crosses a component boundary — see {@link WeightPanel} for
 * why the weight panel's message is held a level above the field that sets it.
 */
type PanelMessage = { readonly tone: 'success' | 'warning' | 'danger'; readonly text: string };

/** What each choice is called, and the units it actually means. */
const CHOICES: Readonly<Record<UnitSystem, { readonly label: string; readonly detail: string }>> = {
  metric: {
    label: 'Kilometres',
    detail: 'Distance in km, speed in km/h, climbing in m.',
  },
  imperial: {
    label: 'Miles',
    detail: 'Distance in mi, speed in mph, climbing in ft.',
  },
};

/** Said when the preference has been written and read back. */
export const UNITS_SAVED = 'Saved. Every screen now reads in these units.';

/** Said when there is nothing to write to. */
export const UNITS_NO_STORE =
  'This browser has no local store, so a choice made here would be forgotten as soon as the ' +
  'page reloaded. Everything is shown in kilometres.';

/** Said when the write failed. Names the failure rather than swallowing it. */
export function unitsSaveFailure(reason: string): string {
  return `That could not be saved, so this device is still reading in the units it was: ${reason}`;
}

/**
 * Why a write can land nowhere without throwing.
 *
 * ⚠️ `setAthleteUnits` answers `undefined` for *"there is no such athlete"* —
 * it does **not** throw, because a missing row is an ordinary state rather than
 * an error. Reachable here: `main.tsx` builds the port unconditionally while
 * `local-athlete.ts` §`renderAfterAthlete` deliberately swallows a failure from
 * `ensureLocalAthlete`, so a start-up where the row could not be created still
 * renders this screen over a store that answers. Discarding that return is
 * CLAUDE.md §5's *"a write that reports success while the read cannot see it"*:
 * every screen would flip to miles, the panel would say `UNITS_SAVED`, and the
 * next reload would be back in kilometres with nothing having said so.
 */
export const UNITS_NO_ATHLETE =
  'there is no athlete row on this device to save it against, so nothing was written';

/** Said when the weight has been written and read back. */
export const MASS_SAVED = 'Saved. The trainer game now rides you at this weight.';

/** Said when the weight has been cleared and the default is back. */
export const MASS_CLEARED = 'Cleared. The trainer game rides you at the assumed weight again.';

/** Where the rider's weight goes, which is nowhere — kept on the screen (#666). */
export const WEIGHT_STAYS_HERE =
  'Nothing is sent anywhere — it is stored on this device with your rides.';

/** Where the announcement choice is kept — on the screen, beside the switch (#699's review, N9). */
export const ANNOUNCEMENTS_STAY_HERE = 'Off unless you turn it on, and kept on this device only.';

/**
 * The sentences on this screen that are never tucked into a "More about"
 * disclosure — #666. They are about what leaves the device and to whom, and
 * what a rider can lose: the map-tile host (#534's review, #558), where a
 * weight is kept, and that clearing site data takes the rides with it.
 * `a11y/kept-visible.a11y.test.tsx` fails this route if any of them has a
 * closed `<details>` above it. Fragments where the sentence names a host.
 */
export const SETTINGS_KEPT_VISIBLE: readonly string[] = [
  WEIGHT_STAYS_HERE,
  ANNOUNCEMENTS_STAY_HERE,
  'opening a ride that has GPS asks',
  'sends the map area and your device’s IP address to',
  'It sends no ride data.',
  'keeps a record of each map request',
  'We don’t use it or share it.',
  'the app asks',
  CLEARING_STILL_REMOVES,
  MASKED_WORDS_LEAD,
  // #836, ADR 0040 D-11: what the goals and documents are kept as, where they
  // go, and that a model reads them.
  ...RIDER_TEXT_KEPT_VISIBLE,
];

/** Said when there is nothing to write a weight to. */
export const MASS_NO_STORE =
  'This browser has no local store, so a weight entered here would be forgotten as soon as the ' +
  'page reloaded.';

/** Said when the write failed. Names the failure rather than swallowing it. */
export function massSaveFailure(reason: string): string {
  return `That could not be saved, so the trainer game is still using the weight it was: ${reason}`;
}

/**
 * Why a weight write can land nowhere without throwing.
 *
 * `setAthleteMass` answers `undefined` for *"there is no such athlete"* for
 * {@link UNITS_NO_ATHLETE}'s reason, and it is reachable here for the same
 * reason. Discarding it would tell a rider the game was riding them at a weight
 * that had never been written down.
 *
 * ⚠️ **The same sentence as {@link UNITS_NO_ATHLETE}, written out rather than
 * shared.** They say the same thing today because the store's two narrow writes
 * fail the same way; they are two panels' copy, and one may be reworded without
 * the other. A shared constant would make "these read alike" a constraint
 * instead of a coincidence, which is not something either panel needs.
 */
export const MASS_NO_ATHLETE =
  'there is no athlete row on this device to save it against, so nothing was written';

/** Said when the kit colour has been written and read back — #623. */
export const KIT_SAVED = 'Saved. You ride in this colour from your next ride.';

/**
 * Said when there is nothing to write the kit colour to — #623.
 *
 * ⚠️ **The control is absent, exactly as the units' and the weight's are** —
 * the owner's ruling of 2026-09-28, which removed a "for this visit only"
 * choice. A choice that could not be kept is not offered; the rider rides in
 * the house kit and is told so.
 */
export const KIT_NO_STORE =
  'This browser has no local store, so a colour chosen here would be forgotten as soon as the ' +
  'page reloaded. You ride in the house kit.';

/**
 * Where the choice is kept, said under "More about your kit". Rendered only
 * where there is a store to keep it in: with none there is no choice to
 * explain, and {@link KIT_NO_STORE} says why.
 */
export const KIT_KEPT =
  'It is kept with your rides and goes with them when you take everything with you.';

/** Said when the write failed. Names the failure rather than swallowing it. */
export function kitSaveFailure(reason: string): string {
  return `That could not be saved, so you still ride in the colour you had: ${reason}`;
}

/**
 * Why a kit write can land nowhere without throwing — {@link UNITS_NO_ATHLETE}'s
 * reason, for #623's narrow write. Written out rather than shared, for
 * {@link MASS_NO_ATHLETE}'s reason.
 */
export const KIT_NO_ATHLETE =
  'there is no athlete row on this device to save it against, so nothing was written';

export interface SettingsViewProps {
  /** `undefined` where this browser has no local store — see {@link UNITS_NO_STORE}. */
  readonly port?: UnitsPort | undefined;
  /** The current choice, from the athlete row `main.tsx` read at start-up. */
  readonly units: UnitSystem;
  /**
   * Told when the write succeeded, so the rest of the client re-renders.
   *
   * ⚠️ **Called only after the store has answered with a written row**, never
   * optimistically and never on the store's `undefined`. A screen that
   * switched to miles and then failed to persist would show a rider miles
   * until they reloaded and kilometres afterwards, with nothing saying which
   * is real — the same class of defect as a write that reports success while
   * the read cannot see it, moved up into the UI. "Answered" is not enough:
   * `undefined` *is* an answer, and it means nothing was written.
   */
  readonly onUnitsChange: (units: UnitSystem) => void;
  /** `undefined` where this browser has no local store — see {@link MASS_NO_STORE}. */
  readonly mass?: AthleteMassPort | undefined;
  /**
   * What the rider currently weighs, or `undefined` where they have never said.
   *
   * ⚠️ **Not defaulted on the way in.** The one place a default is substituted
   * is `athlete/mass.ts` §`riderMassFor`, and this screen has to be able to tell
   * "assumed" from "entered" in order to say which it is showing — a prop that
   * arrived pre-defaulted could not.
   */
  readonly riderMass?: Kilograms | undefined;
  /**
   * Told when the weight write succeeded, so the rest of the client follows.
   *
   * ⚠️ **Called only after the store has answered with a written row**, never
   * optimistically and never on the store's `undefined`, for
   * {@link SettingsViewProps.onUnitsChange}'s reason — and here the
   * disagreement would be a rider being ridden up a hill at a weight the disk
   * does not hold.
   */
  readonly onRiderMassChange: (mass: Kilograms | undefined) => void;
  /** The kit colour's write (#623). `undefined` where this browser has no local store — see {@link KIT_NO_STORE}. */
  readonly kit?: AthleteKitColourPort | undefined;
  /**
   * The rider's kit colour, or `undefined` where they have never chosen —
   * shown as the house kit, which is what they ride in.
   */
  readonly kitColour?: KitColour | undefined;
  /**
   * Told when the rider's choice should be ridden in: only after the store
   * has answered with a written row. Never on the store's `undefined`, for
   * {@link SettingsViewProps.onUnitsChange}'s reason.
   */
  readonly onKitColourChange?: ((kitColour: KitColour | undefined) => void) | undefined;
  /**
   * `navigator.storage`, for the panel that says whether this browser may throw
   * a rider's history away (#409).
   *
   * `undefined` is a legitimate state and not only a test's: a browser with no
   * Storage API says nothing, which is what `PersistenceNotice` renders. Passed
   * in for the reason every other port here is — the accessibility suite
   * renders this route on a machine that is none of the three browsers this has
   * to be right for.
   */
  readonly storage?: StorageManagerLike | undefined;
  /**
   * Where the announcement preference is kept (#397) — this DEVICE's
   * `localStorage` unless a test hands in a double. Not a port on the athlete
   * row: #395 decided the device.
   */
  readonly announcements?: PreferenceStorage | undefined;
  /**
   * The basemap this build draws, so the map-tiles panel can name the host a
   * tile request goes to rather than a host somebody typed beside it —
   * `undefined` for a build configured with none, which contacts no tile host
   * whatever the switch says.
   */
  readonly basemap?: BasemapConfig | undefined;
  /**
   * Where the palette choice is kept (#672) — this DEVICE's `localStorage`
   * unless a test hands in a double, for the reason the announcements are:
   * the choice has to be read before the first paint, which the athlete row
   * cannot be. `design/theme-selection.ts` argues it.
   */
  readonly themeStorage?: ThemeStorage | undefined;
  /**
   * The rider's list of words masked before anything is sent to a hosted
   * model (#839). `undefined` where this browser has no local store — the
   * panel then says so and offers no list.
   */
  readonly maskedWords?: MaskedWordsPort | undefined;
  /**
   * The rider's goals and documents for the ride analysis (#836).
   * `undefined` where this browser has no local store — each panel then says
   * so and offers no control.
   */
  readonly riderText?: RiderTextPort | undefined;
}

export function SettingsView({
  port,
  units,
  onUnitsChange,
  mass,
  riderMass,
  onRiderMassChange,
  kit,
  kitColour,
  onKitColourChange,
  storage,
  announcements,
  basemap,
  themeStorage,
  maskedWords,
  riderText,
}: SettingsViewProps): JSX.Element {
  const [message, setMessage] = useState<PanelMessage | undefined>(undefined);

  async function choose(chosen: UnitSystem): Promise<void> {
    if (port === undefined || chosen === units) {
      return;
    }
    try {
      // ⚠️ The return is read, not discarded. `undefined` means the store found
      // no such athlete and wrote nothing — see {@link UNITS_NO_ATHLETE}.
      const saved = await port.store.setAthleteUnits(port.athleteId, chosen);
      if (saved === undefined) {
        setMessage({ tone: 'danger', text: unitsSaveFailure(UNITS_NO_ATHLETE) });
        return;
      }
      onUnitsChange(chosen);
      setMessage({ tone: 'success', text: UNITS_SAVED });
    } catch (error: unknown) {
      setMessage({
        tone: 'danger',
        text: unitsSaveFailure(error instanceof Error ? error.message : String(error)),
      });
    }
  }

  return (
    // #1014: the cards flow into columns where `main` is wide enough
    // (`theme.css` §"A screen of sections"), in this order — broad ones,
    // because each segmented choice stays on one row.
    <div className="oyl-sections oyl-sections--broad">
      <SettingsCard
        id="oyl-settings-you"
        title={SETTINGS_CARD_TITLES.you}
        picture={
          <>
            <Sky />
            <RoadRibbon />
          </>
        }
      >
        <section className="oyl-panel" aria-labelledby="oyl-units-heading">
          <h3 id="oyl-units-heading">Units</h3>
          <p className="oyl-muted">One choice covers distance, speed, climbing and weight.</p>

          {/*
        A radio group rather than a select, because there are two options and
        both should be readable without opening anything: #238 asks for the
        current unit to be visible rather than implied, and a collapsed select
        shows one option and hides the other. `fieldset`/`legend` is the
        grouping HTML already has, so no ARIA is needed to associate the label
        with the group — the same argument `HudPanel.tsx` makes for `dl`.
      */}
          {/*
        ⚠️ **Absent rather than disabled where there is nothing to write to.**
        `design/Button.tsx` states the rule and #48's first criterion is behind
        it: a disabled control leaves the tab order, so a keyboard user never
        reaches it and never hears why. The explanation takes its place.
      */}
          {port === undefined ? (
            <StatusMessage tone="warning" label="No local store">
              {UNITS_NO_STORE}
            </StatusMessage>
          ) : (
            // #668: a segmented control — the choice changes how numbers are
            // SHOWN, not what happens, and there are two options. Still native
            // radios in a fieldset, so the arrow keys and the grouping are the
            // platform's. The option's detail moved out of its label, where two
            // sentences made each segment several lines tall on a phone, into
            // the description below, which says what the CHOSEN one means.
            <fieldset className="oyl-segmented" aria-describedby="oyl-units-detail">
              <legend>Which units do you ride in?</legend>
              <div className="oyl-segmented__options">
                {UNIT_SYSTEMS.map((option) => (
                  <label key={option} htmlFor={`oyl-units-${option}`}>
                    <input
                      type="radio"
                      id={`oyl-units-${option}`}
                      name="oyl-units"
                      value={option}
                      checked={units === option}
                      onChange={() => {
                        void choose(option);
                      }}
                    />{' '}
                    {CHOICES[option].label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {message === undefined ? null : (
            <StatusMessage tone={message.tone} live>
              {message.text}
            </StatusMessage>
          )}

          {/* #1013: what the chosen units mean is the fieldset's description, and
            here rather than a second line under the heading. */}
          <MoreAbout about="units">
            <p id="oyl-units-detail" className="oyl-muted">
              {CHOICES[units].detail}
            </p>
            <p className="oyl-muted">
              A rider who wants miles for distance and metres for climbing cannot have that — the
              whole app follows one setting, and splitting it later is something we can add without
              taking anything away.
            </p>
            <p className="oyl-muted">
              This changes how numbers are <strong>shown</strong> and nothing else. Every ride stays
              recorded exactly as it was, and a FIT, GPX or TCX file you export is unaffected —
              those formats have their own unit rules and another program reads them.
            </p>
          </MoreAbout>
        </section>

        {/*
        ⚠️ A **sibling section**, not a second fieldset inside the units one.
        `a11y/audit.ts` checks heading order, and a rider looking for "where do
        I put my weight" is looking for a heading rather than for a control
        inside a panel about kilometres and miles. The two do interact — the box
        below is in whichever unit the panel above selects — and that is a
        reason to put them on one screen rather than in one panel.
      */}
        {/*
        ⚠️ **Keyed on the units, and on nothing else.** The panel is what a
        units switch invalidates: the box below it has to be re-seeded in the
        new unit, and a confirmation about the old one has stopped describing
        what is on screen. It is deliberately **not** keyed on `riderMass` —
        that value moves on every successful save, and a remount there threw
        the confirmation away. See {@link WeightPanel}.
      */}
        <WeightPanel
          key={units}
          {...(mass === undefined ? {} : { port: mass })}
          units={units}
          {...(riderMass === undefined ? {} : { riderMass })}
          onRiderMassChange={onRiderMassChange}
        />

        {/* #623. Beside the weight: both are about the rider, and both are kept on the athlete. */}
        <KitPanel
          {...(kit === undefined ? {} : { port: kit })}
          {...(kitColour === undefined ? {} : { kitColour })}
          {...(onKitColourChange === undefined ? {} : { onKitColourChange })}
        />
      </SettingsCard>

      <SettingsCard id="oyl-settings-look" title={SETTINGS_CARD_TITLES.look} picture={<Sky />}>
        <AppearancePanel
          storage={themeStorage === undefined ? deviceThemeStorage() : themeStorage}
        />

        {/*
        #409. Last, because it is the one panel a rider reads rather than
        acts on — and it is on this screen rather than About because About is
        prose about the product and this is a fact about *this browser* that
        can change between visits.
      */}
        <AnnouncementsPanel
          units={units}
          storage={announcements === undefined ? deviceStorage() : announcements}
        />

        <SoundsPanel storage={announcements === undefined ? deviceStorage() : announcements} />
      </SettingsCard>

      <SettingsCard
        id="oyl-settings-ride"
        title={SETTINGS_CARD_TITLES.ride}
        picture={
          <>
            <Sky clouds={false} />
            <Hills />
            <RoadRibbon />
          </>
        }
      >
        <GameWorldPanel storage={announcements === undefined ? deviceStorage() : announcements} />

        <MapTilesPanel
          storage={announcements === undefined ? deviceStorage() : announcements}
          basemap={basemap}
        />
      </SettingsCard>

      {/*
        #839, #836: what is masked, and the goals and documents it is masked in.
        ⚠️ Three cards since #1026, where #942 made them one: the one card was
        1959 px tall at half a landscape tablet, so the row it shared with The
        ride was four times as tall as that card. The sections are in the order
        they were, so the tab order and each one's first control are unchanged.
      */}
      <SettingsCard
        id="oyl-settings-words"
        title={SETTINGS_CARD_TITLES.words}
        picture={
          <>
            <Sky sun={false} />
            <Hills seed={1} />
          </>
        }
      >
        <MaskedWordsPanel port={maskedWords} />
      </SettingsCard>

      <SettingsCard
        id="oyl-settings-goals"
        title={SETTINGS_CARD_TITLES.goals}
        picture={
          <>
            <Sky clouds={false} />
            <Hills seed={3} />
            <RoadRibbon />
          </>
        }
      >
        <RiderTextBox
          port={riderText}
          kind="goal"
          textKey={GOALS_KEY}
          maximum={MAXIMUM_GOALS_CHARACTERS}
          words={GOALS_WORDS}
          headingLevel={3}
        />
      </SettingsCard>

      <SettingsCard
        id="oyl-settings-documents"
        title={SETTINGS_CARD_TITLES.documents}
        picture={
          <>
            <Sky sun={false} clouds={false} />
            <Hills seed={4} />
          </>
        }
      >
        <DocumentsPanel port={riderText} />
      </SettingsCard>

      <SettingsCard
        id="oyl-settings-device"
        title={SETTINGS_CARD_TITLES.device}
        picture={
          <>
            <Sky clouds={false} />
            <Hills seed={2} />
          </>
        }
      >
        {/* #777. A link, not the form: the one screen that sends something to a
          server is its own page, with what it sends above its Connect button. */}
        <section className="oyl-panel" aria-labelledby="oyl-instance-link-heading">
          <h3 id="oyl-instance-link-heading">Instance</h3>
          <p>
            <a href={hrefFor(routeById('instance'))}>Connect to an instance</a>, to ride with other
            people, and see this device’s connection and your devices there.
          </p>
        </section>

        <PersistenceNotice {...(storage === undefined ? {} : { storage })} />
      </SettingsCard>
    </div>
  );
}

/**
 * The titles of the cards Settings' sections are gathered into — #942.
 *
 * ⚠️ **Gathered, not reordered**: every section is where it was, in the order
 * #666 set, so the tab order and each section's own first control are
 * unchanged; the cards only put a title and a picture over a run of them. The
 * titles name a topic and claim nothing about what a section does, because
 * the sentences that do are the sections' own and some are kept visible
 * (`SETTINGS_KEPT_VISIBLE`).
 */
export const SETTINGS_CARD_TITLES = {
  you: 'You and your bike',
  look: 'Look and sound',
  ride: 'The ride',
  words: 'Your words',
  goals: 'Your goals',
  documents: 'Your documents',
  device: 'Connect and keep',
} as const;

/**
 * One titled card of Settings — #942, epic #935.
 *
 * The title is an `h2` and each section inside it an `h3`, so the outline a
 * screen reader walks is the grouping a sighted rider sees. The picture is the
 * illustration kit's, `aria-hidden` by the kit's own rule, and sits BESIDE the
 * title rather than around anything: no sentence is inside an illustration's
 * wrapper (`a11y/kept-visible.a11y.test.tsx` fails one that is). The card's
 * box is token utilities over `surface`, the surface every section already
 * sat on, so no new contrast pair; `theme.css` §`.oyl-settings-card` takes
 * each section's own panel chrome off inside it and rules a line between them.
 */
function SettingsCard({
  id,
  title,
  picture,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly picture: ReactNode;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section
      className="oyl-settings-card tw:bg-surface-raised tw:rounded-card"
      aria-labelledby={id}
    >
      <div className="tw:flex tw:items-center tw:gap-sm tw:mb-md">
        <span className="oyl-settings-card__picture">{picture}</span>
        <h2 id={id} className="tw:mt-0 tw:mb-0">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

/** What each palette choice is called, and what it means (#672). */
const THEME_CHOICE_TEXT: Readonly<
  Record<ThemeChoice, { readonly label: string; readonly detail: string }>
> = {
  device: {
    label: 'Match this device',
    detail: 'Light or dark as this device is set, and it changes when the device does.',
  },
  light: { label: 'Light', detail: 'Light, whatever this device is set to.' },
  dark: { label: 'Dark', detail: 'Dark, whatever this device is set to.' },
};

/** Said beside the choice: where it is kept. */
export const APPEARANCE_STAYS_HERE = 'Kept on this device only. The ride screen does not change.';

/** Said under "More about": where a device that has never chosen starts (#992). */
export const APPEARANCE_STARTS_DARK = 'A device that has not chosen yet starts dark.';

/**
 * Light or dark — #672, the owner's ruling of 2026-09-27, and since #992 (the
 * owner's ruling of 2026-10-02) a device that has never chosen is DARK.
 *
 * ⚠️ **Three choices, as a segmented control of native radios (#668, #667),
 * and not a switch**: a switch has two states, and "follow the device" is the
 * third. Every choice's sentence is under "More about", so the one for a
 * choice not made is still on the screen (#666: nothing is deleted).
 *
 * Applied at once, to this page, through the same rules the inline script
 * uses before the first paint (`design/theme-selection.ts`); a reload is then
 * painted in the chosen palette from its first frame. The ride's HUD is the
 * same in both palettes, which the sentence beside the control says.
 */
function AppearancePanel({ storage }: { readonly storage: ThemeStorage | undefined }): JSX.Element {
  const [choice, setChoice] = useState<ThemeChoice>(() => currentThemeChoice(document, storage));
  const [message, setMessage] = useState<PanelMessage | undefined>(undefined);

  function choose(next: ThemeChoice): void {
    setChoice(next);
    // The page follows what was CHOSEN even where the device would not keep
    // it — held on the page for its life, so a device change later does not
    // undo it — and the message says it will not survive a reload.
    const kept = chooseTheme(
      {
        document,
        localStorage: storage,
        matchMedia:
          typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : undefined,
      },
      next,
    );
    setMessage(
      kept
        ? { tone: 'success', text: ANNOUNCEMENTS_SAVED }
        : { tone: 'warning', text: ANNOUNCEMENTS_NOT_KEPT },
    );
  }

  return (
    <section className="oyl-panel" aria-labelledby="oyl-appearance-heading">
      <h3 id="oyl-appearance-heading">Appearance</h3>
      <fieldset className="oyl-segmented" aria-describedby="oyl-appearance-detail">
        <legend>Light or dark?</legend>
        <div className="oyl-segmented__options">
          {THEME_CHOICES.map((option) => (
            <label key={option} htmlFor={`oyl-theme-${option}`}>
              <input
                type="radio"
                id={`oyl-theme-${option}`}
                name="oyl-theme"
                value={option}
                checked={choice === option}
                onChange={() => {
                  choose(option);
                }}
              />{' '}
              {THEME_CHOICE_TEXT[option].label}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="oyl-muted">{APPEARANCE_STAYS_HERE}</p>
      {message === undefined ? null : (
        <StatusMessage tone={message.tone} live>
          {message.text}
        </StatusMessage>
      )}
      {/* #1013: what the chosen palette means is the fieldset's description, here. */}
      <MoreAbout about="light and dark">
        <p id="oyl-appearance-detail" className="oyl-muted">
          {THEME_CHOICE_TEXT[choice].detail}
        </p>
        <p className="oyl-muted">{APPEARANCE_STARTS_DARK}</p>
        <dl className="oyl-muted">
          {THEME_CHOICES.map((option) => (
            <div key={option}>
              <dt>{THEME_CHOICE_TEXT[option].label}</dt>
              <dd>{THEME_CHOICE_TEXT[option].detail}</dd>
            </div>
          ))}
        </dl>
      </MoreAbout>
    </section>
  );
}

/** What a rider is told when the device kept the choice, and when it would not. */
export const ANNOUNCEMENTS_SAVED = 'Saved on this device.';
export const ANNOUNCEMENTS_NOT_KEPT =
  'This device would not keep that, so it lasts until the page closes. A private window or blocked site data is the usual reason.';

/**
 * Announcements for riding with a screen reader — #397, as #395 decided.
 *
 * ⚠️ **Off by default**, and every row has "never": WCAG 2.2 SC 2.2.2 (Level
 * A) requires the rider to control auto-updating information, and an
 * unasked-for live region interrupts. Kept on THIS DEVICE — assistive
 * technology is a property of the machine a rider sits at — so it needs no
 * store and is offered even where there is none.
 *
 * ⚠️ Not a speech engine: the sentences go into a live region in the ride
 * HUD, and the rider's own screen reader speaks them.
 */
function AnnouncementsPanel({
  units,
  storage,
}: {
  readonly units: UnitSystem;
  readonly storage: PreferenceStorage | undefined;
}): JSX.Element {
  const [preference, setPreference] = useState<AnnouncementPreference>(() =>
    readAnnouncementPreference(storage),
  );
  const [message, setMessage] = useState<PanelMessage | undefined>(undefined);

  function save(next: AnnouncementPreference): void {
    setPreference(next);
    const kept = writeAnnouncementPreference(storage, next);
    setMessage(
      kept
        ? { tone: 'success', text: ANNOUNCEMENTS_SAVED }
        : { tone: 'warning', text: ANNOUNCEMENTS_NOT_KEPT },
    );
  }

  const unit = distanceUnit(units);
  return (
    <section className="oyl-panel oyl-announce" aria-labelledby="oyl-announce-heading">
      <h3 id="oyl-announce-heading">Announcements</h3>
      <p className="oyl-muted">For riding with a screen reader.</p>
      <p>
        <label className="oyl-announce__switch">
          <input
            type="checkbox"
            role="switch"
            checked={preference.enabled}
            onChange={(event) => {
              save({ ...preference, enabled: event.currentTarget.checked });
            }}
          />{' '}
          Announce the ride to a screen reader
        </label>
      </p>
      <EverySelect
        id="oyl-announce-power"
        label="Say your power"
        value={preference.powerEverySeconds}
        choices={POWER_EVERY_CHOICES}
        describe={(seconds) =>
          seconds < 60 ? `every ${String(seconds)} seconds` : `every ${String(seconds / 60)} min`
        }
        onChange={(powerEverySeconds) => {
          save({ ...preference, powerEverySeconds });
        }}
      />
      <EverySelect
        id="oyl-announce-distance"
        label="Say the distance to go"
        value={preference.distanceEvery}
        choices={DISTANCE_EVERY_CHOICES}
        describe={(every) => `every ${String(every)} ${unit}`}
        onChange={(distanceEvery) => {
          save({ ...preference, distanceEvery });
        }}
      />
      <EverySelect
        id="oyl-announce-interval"
        label="Say a workout's next block"
        value={preference.intervalLeadSeconds}
        choices={INTERVAL_LEAD_CHOICES}
        describe={(seconds) => `${String(seconds)} seconds before it starts`}
        onChange={(intervalLeadSeconds) => {
          save({ ...preference, intervalLeadSeconds });
        }}
      />
      <EverySelect
        id="oyl-announce-climb"
        label="Say a climb ahead"
        value={preference.climbLeadMetres}
        choices={CLIMB_LEAD_CHOICES}
        // #399: stored in metres, labelled in the rider's own unit.
        describe={(metres) =>
          `${measurementText(formatSmallDistance(metres, units))} before it starts`
        }
        onChange={(climbLeadMetres) => {
          save({ ...preference, climbLeadMetres });
        }}
      />
      {message === undefined ? null : (
        <StatusMessage tone={message.tone} live>
          {message.text}
        </StatusMessage>
      )}
      {/*
        #699's review (N9): where the choice is kept stays on the screen, as
        "Your weight" keeps WEIGHT_STAYS_HERE there; how the announcements behave
        is what is tucked.
      */}
      <KeptVisible>
        <p className="oyl-muted">{ANNOUNCEMENTS_STAY_HERE}</p>
      </KeptVisible>
      <MoreAbout about="announcements">
        <p className="oyl-muted">
          During a ride in the trainer game, your screen reader is given a short sentence now and
          then — never more than one every few seconds, and nothing you have not chosen above.
        </p>
      </MoreAbout>
    </section>
  );
}

/**
 * Sounds during a ride — #400. Off by default, kept on this device beside the
 * announcements.
 *
 * ⚠️ **The mute is not here, and that is deliberate**: it is on the ride's own
 * screen (`game/SoundControls.tsx`), because WCAG 2.2 SC 1.4.2 needs a rider
 * to be able to stop the sound where it is playing. The volume is here AND
 * there — set once, adjusted mid-ride.
 *
 * ⚠️ Nothing here claims a sound is better than the screen — the research does
 * not establish that. The claim is only what each sound means.
 */
function SoundsPanel({
  storage,
}: {
  readonly storage: PreferenceStorage | undefined;
}): JSX.Element {
  const [preference, setPreference] = useState<CuePreference>(() => readCuePreference(storage));
  const [message, setMessage] = useState<PanelMessage | undefined>(undefined);

  function save(next: CuePreference): void {
    setPreference(next);
    setMessage(
      writeCuePreference(storage, next)
        ? { tone: 'success', text: ANNOUNCEMENTS_SAVED }
        : { tone: 'warning', text: ANNOUNCEMENTS_NOT_KEPT },
    );
  }

  return (
    <section className="oyl-panel oyl-announce oyl-sounds" aria-labelledby="oyl-sounds-heading">
      <h3 id="oyl-sounds-heading">Sounds</h3>
      <p className="oyl-muted">
        Off unless you turn it on; while riding, a Mute sounds button and a volume slider are on the
        ride screen.
      </p>
      <p>
        <label className="oyl-announce__switch">
          <input
            type="checkbox"
            role="switch"
            checked={preference.enabled}
            onChange={(event) => {
              save({ ...preference, enabled: event.currentTarget.checked });
            }}
          />{' '}
          Play sounds during a ride
        </label>
      </p>
      <p>
        <label htmlFor="oyl-sounds-volume">Sound volume</label>{' '}
        <input
          id="oyl-sounds-volume"
          type="range"
          min={0}
          max={100}
          step={10}
          value={Math.round(preference.volume * 100)}
          onChange={(event) => {
            const volume = steppedVolume(Number(event.currentTarget.value) / 100);
            if (volume !== undefined) save({ ...preference, volume });
          }}
        />
      </p>
      {message === undefined ? null : (
        <StatusMessage tone={message.tone} live>
          {message.text}
        </StatusMessage>
      )}
      <MoreAbout about="sounds">
        <p className="oyl-muted">
          Short sounds during a ride, as well as anything your screen reader says: a steady tone
          during a workout that rises when your power is over the target and falls when it is under,
          two rising notes when a workout block changes, and one low note as each distance-to-go
          mark passes in the game. That note plays only with its spoken sentence, so it needs
          announcements turned on above, with &ldquo;Say the distance to go&rdquo; set to a
          distance. The tone is silent whenever there is no power reading.
        </p>
      </MoreAbout>
    </section>
  );
}

/**
 * Which world the trainer game draws — #475, ADR 0026 D-3 and D-12: the
 * realistic world, offered to a rider now that its four layers have landed,
 * **off by default on every device**.
 *
 * ⚠️ **A device choice, not an athlete one** (`world-preference.ts`), and a
 * checkbox rather than a pair of radios: there is one thing to opt in to, and
 * "off" is the product as it has always been. ADR 0026 D-3 says the default
 * changes only on a measurement of a device CLASS, and validation 0002 Part Z
 * is one tablet — so this is the only way in.
 *
 * ⚠️ **What happens offline is said HERE as well as on the ride**, because it
 * is a property of the choice: in a browser the realistic set is not in the
 * service worker's precache (D-7), so with no network a ride falls back to the
 * standard world. The route picker says it again, and the ride's stage says so
 * when it happens.
 */
function GameWorldPanel({
  storage,
}: {
  readonly storage: PreferenceStorage | undefined;
}): JSX.Element {
  const [chosen, setChosen] = useState(() => readRealisticWorldChoice(storage));
  const [message, setMessage] = useState<PanelMessage | undefined>(undefined);
  // ⚠️ `oyl-announce` for its switch's declared 24×24 target (`theme.css`
  // §`.oyl-announce input[type='checkbox']`), as the Sounds panel carries it:
  // without it this checkbox was a browser's own ~13 px, under WCAG 2.2 SC
  // 2.5.8 — #475's review. `oyl-world` is the hook the tests find it by.
  return (
    <section className="oyl-panel oyl-announce oyl-world" aria-labelledby="oyl-world-heading">
      <h3 id="oyl-world-heading">Game world</h3>
      <p>
        <label className="oyl-announce__switch">
          <input
            type="checkbox"
            role="switch"
            checked={chosen}
            onChange={(event) => {
              const next = event.currentTarget.checked;
              setChosen(next);
              setMessage(
                writeRealisticWorldChoice(storage, next)
                  ? { tone: 'success', text: ANNOUNCEMENTS_SAVED }
                  : { tone: 'warning', text: ANNOUNCEMENTS_NOT_KEPT },
              );
            }}
          />{' '}
          Ride in the realistic world
        </label>
      </p>
      {message === undefined ? null : (
        <StatusMessage tone={message.tone} live>
          {message.text}
        </StatusMessage>
      )}
      {/* #1013: the section keeps its switch, and what the two worlds are is here. */}
      <MoreAbout about="the realistic world">
        <p className="oyl-muted">
          The trainer game draws a standard world unless you choose the realistic one: photographic
          road, ground and sky, photoscanned trees and a modelled rider.
        </p>
        <p className="oyl-muted">
          It asks much more of the device. If the device gets too hot during a ride, the rest of
          that ride is in the standard world and the ride screen says so. It has been measured on
          one tablet, not on phones.
        </p>
        <p className="oyl-muted">
          In a browser the realistic world is downloaded when a ride starts — about 33 MB — and is
          not kept on this device for use offline. With no network, or if it cannot be loaded, the
          ride is in the standard world instead and the ride screen says so. In the Android app it
          is already on the device.
        </p>
      </MoreAbout>
    </section>
  );
}

/**
 * Whether a ride's map draws tiles under the line — the owner's decision of
 * 2026-09-25 on #534's review: **on by default, with a switch to turn it off**.
 *
 * ⚠️ **The one Settings switch here that starts ON**, and the only one that
 * decides whether this app contacts a host. So the sentence beside it says
 * exactly what turning it on sends and to whom — the map area around a ride
 * and the device's IP address, to the host named in the build's own basemap
 * URL rather than a host typed beside it — and what turning it off keeps: the
 * line, and the OpenStreetMap credit, which is a licence obligation of the map
 * panel rather than of the tiles. `map/tiles-preference.ts` is the storage
 * rule; `map.browser.spec.ts` §"with map tiles turned off" intercepts the
 * network to show that "off" is no request at all.
 *
 * A build configured with no basemap contacts no tile host whatever this
 * says, so it gets a sentence instead of a switch — absent rather than
 * disabled, for `design/Button.tsx`'s reason.
 */
function MapTilesPanel({
  storage,
  basemap,
}: {
  readonly storage: PreferenceStorage | undefined;
  readonly basemap: BasemapConfig | undefined;
}): JSX.Element {
  const [drawn, setDrawn] = useState(() => readMapTilesChoice(storage));
  const [message, setMessage] = useState<PanelMessage | undefined>(undefined);
  const host = basemap === undefined ? undefined : new URL(basemap.archiveUrl).host;
  // What the host keeps is ours to state only about the host this project
  // runs: Cloudflare keeps a record of each request (IP address, time, device
  // type — not the tile) that our account can see for up to 7 days (#558,
  // `apps/mobile/RELEASE.md` §8 re-checks it). A self-hoster's build names
  // somebody else's server, and this app can say nothing either way about its
  // logs — so for that host there is no retention sentence at all.
  const ours = host !== undefined && host === new URL(PUBLISHED_BASEMAP_URL).host;
  return (
    <section
      className="oyl-panel oyl-announce oyl-map-tiles"
      aria-labelledby="oyl-map-tiles-heading"
    >
      <h3 id="oyl-map-tiles-heading">Ride map</h3>
      {host === undefined ? (
        <KeptVisible>
          <p className="oyl-muted">
            This build has no map configured, so it never asks a tile server for anything. A ride’s
            route is drawn on a plain background.
          </p>
        </KeptVisible>
      ) : (
        <>
          {/*
            #666: kept on the screen, whole. What leaves the device and to whom
            is the privacy sentence #534's review and #558 put beside this
            switch, and a closed disclosure is one press from hidden.
          */}
          <KeptVisible>
            <p className="oyl-muted">
              When this is on, opening a ride that has GPS asks {host} for the map around where you
              rode. That sends the map area and your device’s IP address to {host}. It sends no ride
              data.
              {ours
                ? ` Cloudflare, which runs ${host} for us, keeps a record of each map request — your IP address, the time, and your device or browser type, not which part of the map — that our Cloudflare account can see for up to 7 days. We don’t use it or share it.`
                : ''}{' '}
              When it is off, the app asks {host} for nothing and draws your route on a plain
              background.
            </p>
          </KeptVisible>
          <p>
            <label className="oyl-announce__switch">
              <input
                type="checkbox"
                role="switch"
                checked={drawn}
                onChange={(event) => {
                  const next = event.currentTarget.checked;
                  setDrawn(next);
                  setMessage(
                    writeMapTilesChoice(storage, next)
                      ? { tone: 'success', text: ANNOUNCEMENTS_SAVED }
                      : { tone: 'warning', text: ANNOUNCEMENTS_NOT_KEPT },
                  );
                }}
              />{' '}
              Draw map tiles under my rides
            </label>
          </p>
        </>
      )}
      {message === undefined ? null : (
        <StatusMessage tone={message.tone} live>
          {message.text}
        </StatusMessage>
      )}
    </section>
  );
}

/** One row: a choice of how often, or never. */
function EverySelect(props: {
  readonly id: string;
  readonly label: string;
  readonly value: Every;
  readonly choices: readonly number[];
  readonly describe: (value: number) => string;
  readonly onChange: (value: Every) => void;
}): JSX.Element {
  return (
    <p>
      <label htmlFor={props.id}>{props.label}</label>{' '}
      <select
        className="oyl-input"
        id={props.id}
        value={String(props.value)}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          props.onChange(raw === 'never' ? 'never' : Number(raw));
        }}
      >
        <option value="never">never</option>
        {props.choices.map((choice) => (
          <option key={choice} value={String(choice)}>
            {props.describe(choice)}
          </option>
        ))}
      </select>
    </p>
  );
}

/**
 * What the rider weighs (#325).
 *
 * ## Why this control exists at all
 *
 * `AthleteRecord.mass` had been on the athlete row since schema 6, was read by
 * the segment matcher and by the account export — and **nothing in the program
 * ever wrote one**, so the trainer game rode every athlete at a hard-coded
 * 80 kg. Adding the read without adding this box would have left the fix
 * unreachable: a field with a consumer and no writer is the same defect seen
 * from the other end, and it is the one `check:wiring` cannot see because
 * nothing is dead.
 *
 * ## The box is in the rider's own units, and the store's is not
 *
 * A rider reading in miles types pounds, and what is stored is kilograms —
 * every time, in both systems, because `packages/domain`'s canonical unit does
 * not move for a display preference (ADR 0020). The conversion happens once, in
 * `athlete/mass.ts` §`massToSave`, and the reverse happens once, in
 * `units/format.ts` §`massIn`.
 *
 * ## Two keys, at two levels, and the defect that put them there
 *
 * A remount is the React idiom for *"this input's identity changed"*; the
 * alternative is an effect that writes state during render and is harder to be
 * sure of. Two different things can change that identity, and they are keyed
 * separately because **they invalidate different amounts of state**:
 *
 * - **The units** key this panel, at the call site. Switching to miles has to
 *   re-seed the box with pounds rather than leave a kilogram figure sitting
 *   under a `lb` label — a reading that is wrong by a factor of 2.2 and looks
 *   entirely plausible — and it also retires any confirmation about the weight
 *   in the units it was saved in.
 * - **The stored value** keys {@link WeightField} alone, so that a save
 *   normalises what the rider typed (`64` → `64.0`) and an external write is
 *   not left stale underneath them.
 *
 * ⚠️ **The message is held here, ABOVE the second key, and a review found out
 * why the hard way.** Both keys used to be on `WeightField`, so a successful
 * save — which calls `onRiderMassChange(saved.mass)` and *then* sets the
 * message — moved the key, remounted the field, and landed its own
 * confirmation on the instance it had just destroyed. Nothing was ever
 * announced. The inversion is the tell: re-saving the *same* weight left the
 * key still and the confirmation appeared, so it showed up exactly when
 * nothing had changed.
 *
 * It is not cosmetic. {@link MASS_SAVED} and {@link MASS_CLEARED} are rendered
 * in a `StatusMessage live`, which is the only announcement a screen-reader
 * user gets that the write landed at all.
 *
 * ⚠️ **No view-level test could see it**, because every case in
 * `SettingsView.test.tsx` passes `onRiderMassChange={() => undefined}` — the
 * prop never moves, so the key never moves. That is CLAUDE.md §5's *wrong
 * harness*: the double is inert in exactly the dimension the defect lives in.
 * `shell/AppShell.test.tsx` §`what the rider weighs (#325)` is where the
 * regression is held, because the shell is the one place that supplies a real
 * setter.
 */
function WeightPanel({
  port,
  units,
  riderMass,
  onRiderMassChange,
}: {
  readonly port?: AthleteMassPort | undefined;
  readonly units: UnitSystem;
  readonly riderMass?: Kilograms | undefined;
  readonly onRiderMassChange: (mass: Kilograms | undefined) => void;
  /**
   * `navigator.storage`, for the panel that says whether this browser may throw
   * a rider's history away (#409).
   *
   * `undefined` is a legitimate state and not only a test's: a browser with no
   * Storage API says nothing, which is what `PersistenceNotice` renders. Passed
   * in for the reason every other port here is — the accessibility suite
   * renders this route on a machine that is none of the three browsers this has
   * to be right for.
   */
  readonly storage?: StorageManagerLike | undefined;
}): JSX.Element {
  const current = riderMassFor(riderMass);
  // ⚠️ Here rather than in `WeightField`, which is remounted by a save. See the
  // note above: this is the state the field's own key used to discard.
  const [message, setMessage] = useState<PanelMessage | undefined>(undefined);
  return (
    <section className="oyl-panel" aria-labelledby="oyl-weight-heading">
      <h3 id="oyl-weight-heading">Your weight</h3>
      <KeptVisible>
        <p className="oyl-muted">{WEIGHT_STAYS_HERE}</p>
      </KeptVisible>

      {port === undefined ? (
        <StatusMessage tone="warning" label="No local store">
          {MASS_NO_STORE}
        </StatusMessage>
      ) : (
        // ⚠️ Remounted when the stored value changes, so the box shows what
        // landed rather than what was typed. The units are the panel's key, one
        // level up, because they invalidate the message too. See the note above.
        <WeightField
          key={String(riderMass ?? '')}
          port={port}
          units={units}
          {...(riderMass === undefined ? {} : { riderMass })}
          onRiderMassChange={onRiderMassChange}
          {...(message === undefined ? {} : { message })}
          onMessage={setMessage}
        />
      )}

      {/* #1013: the weight rides use is the section's one line; why an assumed
        one is wrong and the bicycle are in the More about. How to clear it is
        the field's own hint (#1023). */}
      <p className="oyl-muted">
        {current.assumed ? 'You have not entered one, so rides use an assumed ' : 'Rides use '}
        {measurementText(formatMass(current.mass, units))}.
      </p>
      <MoreAbout about="your weight">
        {current.assumed ? (
          <p className="oyl-muted">
            That is a stand-in and not a measurement, and it is wrong for almost everybody.
          </p>
        ) : null}
        <p className="oyl-muted">
          A bicycle is added to it — the game rides a rider and a bike, not a rider.
        </p>
        <p className="oyl-muted">
          The trainer game works out how fast you are going from how hard you are pedalling, and
          what you weigh is most of the answer on a climb.
        </p>
        {/*
          ⚠️ #365's fifth criterion, and the half a weight box cannot carry on
          its own: weight is most of the answer on a climb and almost none of it
          on the flat, where what decides a rider's speed is how much air they
          are pushing. That is chosen per ride on the game screen —
          `game/rider.ts` §`RIDING_POSITIONS` — and a rider told only about
          their weight would go looking for the flat-road setting here and not
          find one.
        */}
        <p className="oyl-muted">
          On the flat it is mostly air rather than weight. How you are riding — sitting up, on the
          hoods, in the drops — is chosen for each ride on the{' '}
          <a href={hrefFor(routeById('game'))}>trainer game screen</a>.
        </p>
      </MoreAbout>
    </section>
  );
}

/**
 * The main colour of the rider's kit in the trainer game — #623's second half.
 *
 * ⚠️ **A radio group of a fixed, named palette, never a colour picker**: the
 * owner's ruling, and `game/bicycle.ts` §`KIT_PALETTE` says why — a free
 * colour could make the rider look like the pacer or the ghost. Five options,
 * so not a segmented control (#668 stops at three): a column of #667's radio
 * ROWS, each a 44 px label wrapping its native radio. Each option is its NAME;
 * the swatch beside it is decoration, hidden from assistive technology, so no
 * option is told by colour alone (SC 1.4.1).
 *
 * The current choice is always selected — the house kit for a rider who never
 * chose, which is what they ride in (ADR 0020 D-3: a default the rider can
 * see).
 */
function KitPanel({
  port,
  kitColour,
  onKitColourChange,
}: {
  readonly port?: AthleteKitColourPort | undefined;
  readonly kitColour?: KitColour | undefined;
  readonly onKitColourChange?: ((kitColour: KitColour | undefined) => void) | undefined;
}): JSX.Element {
  // What is shown as chosen: a palette key, the house kit for anything else —
  // the same answer `bicycle.ts` §`riderKitFor` draws.
  const current = parseKitColour(kitColour);
  const [message, setMessage] = useState<PanelMessage | undefined>(undefined);

  async function choose(chosen: KitColour): Promise<void> {
    if (port === undefined || chosen === current) {
      return;
    }
    try {
      // ⚠️ The return is read, not discarded — see {@link KIT_NO_ATHLETE}.
      const saved = await port.store.setAthleteKitColour(port.athleteId, chosen);
      if (saved === undefined) {
        setMessage({ tone: 'danger', text: kitSaveFailure(KIT_NO_ATHLETE) });
        return;
      }
      // What landed, not what was asked for: the store writes a palette key.
      onKitColourChange?.(saved.kitColour);
      setMessage({ tone: 'success', text: KIT_SAVED });
    } catch (error: unknown) {
      setMessage({
        tone: 'danger',
        text: kitSaveFailure(error instanceof Error ? error.message : String(error)),
      });
    }
  }

  return (
    <section className="oyl-panel" aria-labelledby="oyl-kit-heading">
      <h3 id="oyl-kit-heading">Your kit</h3>
      {/*
        ⚠️ **Absent rather than disabled where there is nothing to write to** —
        the units' and the weight's rule, and the owner's ruling of 2026-09-28.
        There is no "for this visit" choice: the explanation takes its place,
        and so does the "More about", which explains a choice not on offer.
      */}
      {port === undefined ? (
        <StatusMessage tone="warning" label="No local store">
          {KIT_NO_STORE}
        </StatusMessage>
      ) : (
        <KitChoice current={current} choose={choose} />
      )}

      {message === undefined ? null : (
        <StatusMessage tone={message.tone} live>
          {message.text}
        </StatusMessage>
      )}

      {port === undefined ? null : (
        <MoreAbout about="your kit">
          <p className="oyl-muted">
            The pacer rides in orange and your own best in grey-blue, so there is no red, orange or
            blue here: a rider in either could be taken for one of them at a glance.
          </p>
          <p className="oyl-muted">{KIT_KEPT}</p>
        </MoreAbout>
      )}
    </section>
  );
}

/** The five named options — #623. Only ever rendered with a store to write to. */
function KitChoice({
  current,
  choose,
}: {
  readonly current: KitColour;
  readonly choose: (chosen: KitColour) => Promise<void>;
}): JSX.Element {
  return (
    <fieldset className="oyl-kit oyl-chips">
      <legend>What colour is your kit in the trainer game?</legend>
      <div className="oyl-kit__options oyl-chips__options">
        {KIT_COLOURS.map((option) => (
          <label key={option} htmlFor={`oyl-kit-${option}`}>
            <input
              type="radio"
              id={`oyl-kit-${option}`}
              name="oyl-kit"
              value={option}
              checked={current === option}
              onChange={() => {
                void choose(option);
              }}
            />
            <span
              className="oyl-kit__swatch"
              aria-hidden="true"
              style={{
                backgroundColor: `#${KIT_PALETTE[option].kit.jersey.toString(16).padStart(6, '0')}`,
              }}
            />
            {KIT_PALETTE[option].name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The box, the button and what they are told.
 *
 * ⚠️ **`message` is a prop and not state.** A successful save moves
 * `riderMass`, which is this component's key, so anything held here is
 * discarded before it can be rendered — see {@link WeightPanel}.
 *
 * @see WeightPanel
 */
/** The weight box's hint, which the box is described by — #1023. */
const WEIGHT_HINT_ID = 'oyl-rider-mass-hint';

function WeightField({
  port,
  units,
  riderMass,
  onRiderMassChange,
  message,
  onMessage,
}: {
  readonly port: AthleteMassPort;
  readonly units: UnitSystem;
  readonly riderMass?: Kilograms | undefined;
  readonly onRiderMassChange: (mass: Kilograms | undefined) => void;
  readonly message?: PanelMessage | undefined;
  readonly onMessage: (message: PanelMessage | undefined) => void;
}): JSX.Element {
  // ⚠️ Seeded to one decimal place, which makes a re-save in imperial a
  // slightly lossy round trip: 69.853 kg shows as `154.0` lb and saves back as
  // 69.85322 kg. Raised in review and left as it is. The error is bounded by
  // half a tenth of a pound — 0.05 × 0.45359237 = **22.7 g at worst**, and
  // 0.2 g in that example — on a rider-plus-bicycle of about eighty kilograms,
  // which is three orders of magnitude below what a bathroom scale reports and
  // far below anything `packages/physics` could express as a speed. Keeping the
  // original kilograms for an unedited box would need a second piece of state
  // whose only job is to be invisible.
  const [typed, setTyped] = useState(
    riderMass === undefined ? '' : massIn(riderMass, units).toFixed(1),
  );
  async function save(): Promise<void> {
    const decision = massToSave(typed, units);
    if (decision.kind === 'refused') {
      onMessage({ tone: 'danger', text: decision.reason });
      return;
    }
    try {
      // ⚠️ The return is read, not discarded. `undefined` means the store found
      // no such athlete and wrote nothing — see {@link MASS_NO_ATHLETE}.
      const saved = await port.store.setAthleteMass(port.athleteId, decision.mass);
      if (saved === undefined) {
        onMessage({ tone: 'danger', text: massSaveFailure(MASS_NO_ATHLETE) });
        return;
      }
      // ⚠️ `saved.mass` rather than `decision.mass`: what the rest of the
      // client is told is what came back off the row, so a store that stored
      // something else cannot be papered over by the value we sent it.
      //
      // ⚠️ **This is what remounts the component the line below it is setting
      // a message on**, which is why that message is the panel's state rather
      // than this one's. See {@link WeightPanel}.
      onRiderMassChange(saved.mass);
      onMessage({
        tone: 'success',
        text: decision.mass === undefined ? MASS_CLEARED : MASS_SAVED,
      });
    } catch (error: unknown) {
      onMessage({
        tone: 'danger',
        text: massSaveFailure(error instanceof Error ? error.message : String(error)),
      });
    }
  }

  return (
    <div className="oyl-trainer__form">
      <p>
        <label htmlFor="oyl-rider-mass">Your weight ({massUnit(units)})</label>{' '}
        {/*
          #994: − and + beside the box, which still takes typing. A box left
          blank starts from the assumed weight the sentence below names, in
          the rider's own units, so the first press is not a step from nothing.
          Nothing is saved until *Save weight*, exactly as with typing.
        */}
        <Stepper
          name="weight"
          step={0.5}
          min={0}
          start={Number(formatMass(kilograms(DEFAULT_RIDER_MASS_KILOGRAMS), units).value)}
        >
          <input
            className="oyl-input"
            id="oyl-rider-mass"
            inputMode="decimal"
            value={typed}
            placeholder="not set"
            aria-describedby={WEIGHT_HINT_ID}
            onChange={(event) => {
              setTyped(event.target.value);
              onMessage(undefined);
            }}
          />
        </Stepper>
      </p>
      {/* #1023: an instruction for this field is under it and is its
        description (WCAG 2.2 SC 3.3.2), not in a disclosure away from it. */}
      <p id={WEIGHT_HINT_ID} className="oyl-muted oyl-field-hint">
        Leave it blank to go back to the assumed{' '}
        {measurementText(formatMass(kilograms(DEFAULT_RIDER_MASS_KILOGRAMS), units))}.
      </p>
      <Button
        onClick={() => {
          void save();
        }}
      >
        Save weight
      </Button>

      {message === undefined ? null : (
        <StatusMessage tone={message.tone} live>
          {message.text}
        </StatusMessage>
      )}
    </div>
  );
}
