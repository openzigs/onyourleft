// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The legal and contact page** (#908): `GET /legal`, naming who to write
 * to, where to send a notice, who is accountable, and the documents a rider
 * is bound by — all from the OPERATOR's configuration, so a self-hoster names
 * their own and never inherits the project's.
 *
 * DSA Art. 11(2) and 12(2): *"make public the information necessary to easily
 * identify and communicate with their single points of contact … easily
 * accessible, and … kept up to date"*; Art. 11(3) the languages; Art. 12(1)
 * *"shall not solely rely on automated tools"* — the page says a person
 * reads every message. OSA Codes ICU A2: the individual accountable for the
 * illegal content safety duties. Art. 13(4): a legal representative's name,
 * postal address, email and telephone, only if the operator has one.
 *
 * ## What an operator sets
 *
 * | Setting | What it names | Unset |
 * | --- | --- | --- |
 * | `OYL_INSTANCE_CONTACT_EMAIL` | the single point of contact, for authorities and for riders | the page says no contact is published |
 * | `OYL_INSTANCE_CONTACT_LANGUAGES` | the languages it can be written to in, separated by commas | `English` |
 * | `OYL_INSTANCE_ACCOUNTABLE_PERSON` | the person accountable for keeping illegal content off it | the page says nobody is named |
 * | `OYL_INSTANCE_LEGAL_REPRESENTATIVE` | the Art. 13 legal representative, one line | not shown |
 * | `OYL_INSTANCE_PRIVACY_POLICY_URL` | the operator's privacy policy, `https:` | the page says none is published |
 * | `OYL_INSTANCE_PUBLIC_ROOMS` | `on` or `off`: whether this instance offers public rooms | `off` |
 *
 * ⚠️ **`OYL_INSTANCE_PUBLIC_ROOMS=on` with no contact address or no
 * accountable person is a refusal to start**, as a missing source offer is
 * (ADR 0036 D-6, `config.ts`): an instance open to strangers with nobody to
 * write to is the one configuration this page exists to prevent. No room is
 * public yet (`rooms/rooms.ts`: no field makes one); the setting is the gate
 * public rooms will be opened behind, and today it opens nothing else.
 */

import { escapeHtml, htmlPage } from './html.ts';
import { EMAIL } from './moderation/notices.ts';

/** What the legal page names, from the operator's settings. */
export interface LegalSettings {
  /** The single point of contact's email address, or `null`. */
  readonly contactEmail: string | null;
  /** The languages the contact can be written to in, at least one. */
  readonly contactLanguages: readonly string[];
  /** The person accountable for the illegal content duties, or `null`. */
  readonly accountablePerson: string | null;
  /** The Art. 13 legal representative, as one line, or `null`. */
  readonly legalRepresentative: string | null;
  /** The operator's privacy policy, `https:`, or `null`. */
  readonly privacyPolicyUrl: string | null;
  /** Whether this instance offers public rooms: refused at start without a contact (#908). */
  readonly publicRooms: boolean;
}

/** The raw settings, as the environment gives them. */
export interface RawLegalSettings {
  readonly contactEmail?: string | undefined;
  readonly contactLanguages?: string | undefined;
  readonly accountablePerson?: string | undefined;
  readonly legalRepresentative?: string | undefined;
  readonly privacyPolicyUrl?: string | undefined;
  readonly publicRooms?: string | undefined;
}

/** The legal page's path, which the app's About links to. */
export const LEGAL_PAGE_PATH = '/legal';

/** The longest name or line an operator may set here, in characters. */
export const MAXIMUM_LEGAL_LINE_LENGTH = 500;

/** A character a reader's screen should never be handed. */
const UNSHOWABLE = /[\p{Cc}\p{Cf}\u2028\u2029]/u;

const present = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== '';

/** Read the settings; every problem is pushed onto `problems`, as `readConfig` collects them. */
export function readLegalSettings(raw: RawLegalSettings, problems: string[]): LegalSettings {
  const line = (value: string | undefined, name: string): string | null => {
    if (!present(value)) return null;
    const trimmed = value.trim();
    if ([...trimmed].length > MAXIMUM_LEGAL_LINE_LENGTH || UNSHOWABLE.test(trimmed)) {
      problems.push(
        `${name} must be one line of at most ${String(MAXIMUM_LEGAL_LINE_LENGTH)} characters, with no control, bidirectional or invisible character.`,
      );
      return null;
    }
    return trimmed;
  };

  let contactEmail: string | null = null;
  if (present(raw.contactEmail)) {
    const value = raw.contactEmail.trim();
    if (value.length <= 254 && EMAIL.test(value)) {
      contactEmail = value;
    } else {
      problems.push('OYL_INSTANCE_CONTACT_EMAIL must be an email address.');
    }
  }

  let contactLanguages: readonly string[] = ['English'];
  if (present(raw.contactLanguages)) {
    const listed = raw.contactLanguages
      .split(',')
      .map((each) => each.trim())
      .filter((each) => each !== '');
    if (
      listed.length === 0 ||
      listed.some((each) => [...each].length > 64 || UNSHOWABLE.test(each))
    ) {
      problems.push(
        'OYL_INSTANCE_CONTACT_LANGUAGES must be language names separated by commas, such as English, Welsh.',
      );
    } else {
      contactLanguages = listed;
    }
  }

  const accountablePerson = line(raw.accountablePerson, 'OYL_INSTANCE_ACCOUNTABLE_PERSON');
  const legalRepresentative = line(raw.legalRepresentative, 'OYL_INSTANCE_LEGAL_REPRESENTATIVE');

  let privacyPolicyUrl: string | null = null;
  if (present(raw.privacyPolicyUrl)) {
    let parsed: URL | undefined;
    try {
      parsed = new URL(raw.privacyPolicyUrl.trim());
    } catch {
      parsed = undefined;
    }
    if (parsed?.protocol === 'https:') {
      privacyPolicyUrl = parsed.href;
    } else {
      problems.push('OYL_INSTANCE_PRIVACY_POLICY_URL must be an https: URL.');
    }
  }

  let publicRooms = false;
  if (present(raw.publicRooms)) {
    const value = raw.publicRooms.trim().toLowerCase();
    if (value === 'on' || value === 'off') {
      publicRooms = value === 'on';
    } else {
      problems.push('OYL_INSTANCE_PUBLIC_ROOMS must be on or off.');
    }
  }
  if (publicRooms && (contactEmail === null || accountablePerson === null)) {
    problems.push(
      'OYL_INSTANCE_PUBLIC_ROOMS is on, so set OYL_INSTANCE_CONTACT_EMAIL and OYL_INSTANCE_ACCOUNTABLE_PERSON: an instance that offers public rooms must publish whom to write to and who is accountable (DSA Arts 11 and 12, OSA Codes ICU A2; #908).',
    );
  }

  return {
    contactEmail,
    contactLanguages,
    accountablePerson,
    legalRepresentative,
    privacyPolicyUrl,
    publicRooms,
  };
}

/** The settings an instance has when its operator set none. */
export const NO_LEGAL_SETTINGS: LegalSettings = readLegalSettings({}, []);

/** The page's heading, which is also its title. */
export const LEGAL_PAGE_HEADING = 'Legal information and contact';

/** What the page needs beyond the legal settings. */
export interface LegalPageContext {
  readonly legal: LegalSettings;
  readonly instanceName: string | null;
  /** Where the running build's source is (AGPL-3.0 §13). */
  readonly sourceUrl: string;
  /** The notice page's path (#907). */
  readonly noticePath: string;
  /** The terms page's path when the instance publishes terms (#909), or `null`. */
  readonly termsPath?: string | null;
}

/** The legal and contact page. */
export function legalPage(context: LegalPageContext): string {
  const { legal } = context;
  const name =
    context.instanceName === null ? 'this instance' : `the instance ${context.instanceName}`;
  const link = (href: string, text: string): string =>
    `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
  const languages = legal.contactLanguages.join(', ');
  const contact =
    legal.contactEmail === null
      ? '<p>The person who runs this instance has not published a contact address.</p>'
      : `<p>Write to ${link(`mailto:${legal.contactEmail}`, legal.contactEmail)}. This is the single point of contact for this instance, for authorities and for the people who use it alike. A person reads every message. You can write in: ${escapeHtml(languages)}.</p>`;
  const accountable =
    legal.accountablePerson === null
      ? '<p>The person who runs this instance has not named the person accountable for it.</p>'
      : `<p>${escapeHtml(legal.accountablePerson)} is accountable for keeping illegal content off ${escapeHtml(name)}.</p>`;
  const representative =
    legal.legalRepresentative === null
      ? ''
      : `<h2>Legal representative in the European Union</h2>
<p>${escapeHtml(legal.legalRepresentative)}</p>`;
  const privacy =
    legal.privacyPolicyUrl === null
      ? '<li>This instance has published no privacy policy.</li>'
      : `<li>${link(legal.privacyPolicyUrl, 'Privacy policy')}</li>`;
  return htmlPage(
    `${LEGAL_PAGE_HEADING} — ${context.instanceName ?? 'On Your Left instance'}`,
    `<h1>${escapeHtml(LEGAL_PAGE_HEADING)}</h1>
<p>Who runs ${escapeHtml(name)}, how to reach them, and where to report content.</p>
<h2>Contact</h2>
${contact}
<h2>Report content you think is illegal</h2>
<p>Anybody, with or without an account, can use the ${link(context.noticePath, 'notice page')} to report content on this instance that they think is illegal.</p>
<h2>Who is accountable</h2>
${accountable}
${representative}
<h2>Documents</h2>
<ul>
${
  context.termsPath === undefined || context.termsPath === null
    ? '<li>This instance has published no terms of service.</li>'
    : `<li>${link(context.termsPath, 'Terms of service')}</li>`
}
${privacy}
<li>${link(context.sourceUrl, 'The source code of this instance')}, under the GNU Affero General Public License, version 3 or later.</li>
</ul>`,
  );
}
