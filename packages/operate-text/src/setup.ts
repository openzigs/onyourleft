// SPDX-License-Identifier: Apache-2.0

/**
 * **The first-run setup wizard's words** (#2784, ADR 0080 D-1, D-2, D-4, D-6,
 * D-7): what the instance's `/setup` pages on the server machine say, step by
 * step, to an owner who has never edited a `.env` file. Kept here beside the
 * Operate sections' words (ADR 0069 D-7), so the app can say the same thing
 * one day without a second copy.
 *
 * **Plain words first.** The reader is a non-technical owner: a sentence on a
 * page names no environment variable and no command. Those are kept for the
 * reader who wants them, in a collapsed "for people comfortable with the
 * command line" block ({@link SETUP_EXPERT_SUMMARY}).
 *
 * Nothing here is a code, a key, a secret or an address of anybody's: a page
 * puts those in, escaped, where it must.
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval.**
 */

import type { OperateGpuFit } from './analysis';
import { bytesText, durationText } from './words';

/** The wizard's steps, in order: `apps/instance`'s `SETUP_STEPS`, which its tests hold this to. */
export type OperateSetupStep =
  | 'claim'
  | 'tailnet'
  | 'passkey'
  | 'secrets'
  | 'backups'
  | 'registration'
  | 'invite'
  | 'ai'
  | 'finish';

/** Each step's name, as its page's heading. */
export const SETUP_STEP_NAMES: Readonly<Record<OperateSetupStep, string>> = {
  claim: 'Claim it with your tablet',
  // Named as the progress bar names it (owner, 2026-11-19): one name for one step.
  tailnet: 'Tailnet',
  passkey: 'A passkey for the admin pages',
  secrets: 'The emergency kit',
  backups: 'Backups',
  registration: 'Who may join',
  invite: 'Invite a rider',
  ai: 'AI write-ups',
  finish: 'Finish',
};

/** Each step's short name, in the progress bar across the top of every step's page. */
export const SETUP_STEP_SHORT_NAMES: Readonly<Record<OperateSetupStep, string>> = {
  claim: 'Claim',
  tailnet: 'Tailnet',
  passkey: 'Passkey',
  secrets: 'Emergency kit',
  backups: 'Backups',
  registration: 'Who may join',
  invite: 'Invite',
  ai: 'AI',
  finish: 'Finish',
};

/**
 * Read out before a step's name in the progress bar: its number, which is what
 * a narrow screen shows of it (WCAG 2.5.3, label in name), and whether it is
 * done (the tick is drawn, not read). "Step 5:", "Step 1, done:".
 */
export function setupStepNumberText(number: number, done: boolean): string {
  return `Step ${String(number)}${done ? ', done' : ''}:`;
}

/** The title every setup page carries. */
export const SETUP_TITLE = 'Set up this instance';

/** The locked page: what the code is and where it is. */
export const SETUP_LOCKED_LEAD =
  'This page sets up the instance, on this machine only. To begin, type the setup code. It is in the file setup-code, in the secrets folder beside compose.yaml. A code works once, for 10 minutes.';

/**
 * The operator commands the wizard names, whole (#2858): each run on this
 * machine, in the folder that holds compose.yaml, and shown in a block to copy.
 */
export const SETUP_COMMANDS = {
  setupCode: 'docker compose exec instance node src/operator/cli.ts setup-code',
  restart: 'docker compose restart instance',
  ownerClaimReset: 'docker compose exec instance node src/operator/cli.ts owner-claim reset',
  adminPagesOn: 'docker compose up -d instance',
  adminCode: 'docker compose exec instance node src/operator/cli.ts admin-code',
  adminPasskeysList: 'docker compose exec instance node src/operator/cli.ts admin-passkeys list',
  adminPasskeysConfirm:
    'docker compose exec instance node src/operator/cli.ts admin-passkeys confirm <id>',
  backupStatus: 'docker compose ps backup',
  instanceKeyReset: 'docker compose exec instance node src/operator/cli.ts instance-key reset',
} as const;

/**
 * One line of a step's command-line details: what to do, then the commands it
 * names, whole, which the page draws after it in blocks to copy (#2858).
 */
export interface SetupHowLine {
  readonly text: string;
  readonly commands: readonly string[];
}

/** Before the commands that make a new code: in the folder that holds compose.yaml. */
export const SETUP_COMMANDS_WHERE =
  'Run it in a terminal on this machine, in the folder that holds compose.yaml.';

/** How to get a new code, without a button the tunnel could press (ADR 0080 D-2). */
export const SETUP_NEW_CODE_TEXT =
  'Each start of the instance makes a new code, and so does the command below. If yours has run out, run it, then open the file again.';

/** The code's label. */
export const SETUP_CODE_LABEL = 'Setup code';

/** The one sentence for a code that was not accepted, whatever the reason (ADR 0080 D-2). */
export const SETUP_CODE_REFUSED_TEXT =
  'That code was not accepted. A code works once, for 10 minutes: open the file again after a restart for a new one.';

/** Too many attempts, from this machine or all together (ADR 0069 D-4's limits). */
export const SETUP_TOO_MANY_TEXT = 'Too many attempts. Wait a minute, then try again.';

/** The page for any address but `localhost:<port>` (ADR 0080 D-1). */
export const SETUP_WRONG_ADDRESS_TEXT =
  'The setup page is served at one address only, on this machine:';

/** A form that did not come from the setup page's own origin. */
export const SETUP_FORM_REFUSED_TEXT =
  'That form did not come from this setup page, so nothing was changed. Go back to the setup page and try again.';

/** The line under every step's page: how long the session lasts. */
export const SETUP_SESSION_TEXT =
  'This setup session ends after 15 minutes without use, and 2 hours after you typed the code. Leave whenever you like: the setup starts again at this step.';

/** The button that moves on. */
export const SETUP_NEXT_BUTTON = 'Next step';

/** The steps list's name. */
export const SETUP_STEPS_LABEL = 'Setup steps';

/** The heading of every collapsed block that holds commands and settings names. */
export const SETUP_EXPERT_SUMMARY = 'For people comfortable with the command line';

/**
 * The button on a page that waits for something outside this browser: pressed,
 * it loads the page again. No page reloads by itself (WCAG 2.2.1, F41).
 */
export const SETUP_CHECK_NOW_BUTTON = 'Check now';

/**
 * When a code stops working, from the seconds it has left: "in 10 minutes",
 * "in 7 days". Relative, so it never needs a time zone: the server's clock and
 * the reader's are the same machine's, but its zone is often UTC in a container.
 */
export function expiresInText(seconds: number): string {
  if (seconds < 60) return 'in less than a minute';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 120) return `in ${String(minutes)} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `in ${String(hours)} hours`;
  return `in ${String(Math.floor(hours / 24))} days`;
}

/**
 * How long ago something ran, from the seconds since: "less than a minute
 * ago", "14 minutes ago", "3 hours 5 minutes ago". Relative, for
 * {@link expiresInText}'s reason: a moment in UTC is not the owner's time
 * (#2825). A clock that stepped back reads as "less than a minute ago".
 */
export function ranAgoText(seconds: number): string {
  return `${durationText(seconds)} ago`;
}

/** A code shown on a step's page: it works once, and stops working {@link expiresInText}. */
export function codeWorksOnceText(seconds: number): string {
  return `It works once, and stops working ${expiresInText(seconds)}.`;
}

// --- claim (ADR 0080 D-3, D-5)

export const CLAIM_LEAD =
  'Your tablet becomes this server’s owner: the one account that runs it. Show a claim code here, scan it with the On Your Left app on your tablet, then check that both screens show the same number.';
export const CLAIM_SHOW_BUTTON = 'Show the claim code';
/** Above the claim QR, in place of the admin page's own words (#2783). */
export const CLAIM_CODE_LEAD =
  'Scan this with the On Your Left app on your tablet. In the app, open More, then Instance, and use its own scanner, not the camera app. Your tablet then shows a six-digit number.';
/** Below the claim QR, while no tablet has scanned it. */
export const CLAIM_WAITING_TEXT =
  'Waiting for your tablet to scan the code. Once it has, press I’ve scanned it, and this page shows the number to compare.';
/** The claim step's button once the tablet has scanned the code: it loads the step again. */
export const CLAIM_SCANNED_BUTTON = 'I’ve scanned it';
export const CLAIM_PENDING_LEAD =
  'A tablet has scanned the code. Does your tablet show this number?';
export const CLAIM_PENDING_LABEL = 'The number on this screen';
export const CLAIM_YES_BUTTON = 'Yes, it shows the same number';
export const CLAIM_NO_BUTTON = 'No, it shows another number or none';
export const CLAIM_NO_TEXT =
  'If the numbers differ, somebody else may have scanned the code: say No, and show a new code.';
/** The claim step once the owner is the tablet's: a success, before the next step. */
export const CLAIMED_TEXT = 'Your tablet now owns this server.';
export const CLAIMED_NEXT_TEXT =
  'Nobody else can claim it now. Press Next step to carry on with the setup.';
export const CLAIMED_WRONG_TEXT =
  'If the wrong tablet claimed it, run this command on this machine, then open this page again and claim it with the right tablet:';
export const CLAIM_NOT_CONFIRMED_TEXT =
  'That claim could not be confirmed: it ran out, or a new code replaced it. Show a new claim code and scan it again.';
/**
 * The claim step after a restart voided the code the server showed before
 * (#2858): the QR on an old page no longer works.
 */
export const CLAIM_RESTARTED_TEXT =
  'The server restarted, so a claim code it showed before no longer works. Show a new one.';
/** The claim step once the code it showed has run out: why the QR went, in one sentence (#2825). */
export const CLAIM_EXPIRED_TEXT = 'That code ran out. Show a new one.';
export const CLAIM_NO_CARD_TEXT =
  'The instance’s own keys could not be read, so there is no card to claim it with. The instance makes them when it starts with its secret key: restart it, then come back.';

// --- the tailnet (#2817, ADR 0079 D-2, D-3, D-8)

/** Which way in this server's settings name (`OYL_INSTANCE_REMOTE_PATH`), or `null` for none. */
export type OperateRemotePath = 'tailnet' | 'funnel' | 'cloudflare';

/** What the tailnet step says first, on the tailnet path and on Funnel's. */
export const TAILNET_STEP_LEAD =
  'Riders reach this server over your Tailscale network, called your tailnet. Only devices you let on to it can reach the server; nothing else on the internet can.';
/** Before the address the running server read back, which the page draws after it. */
export const TAILNET_ADDRESS_LEAD = 'This server is running with this address:';
/** The address is a Tailscale name, as the tailnet path needs. */
export const TAILNET_ADDRESS_OK_TEXT =
  'That is a Tailscale address, so a device on your tailnet can reach it.';
/** The tailnet path is chosen, but the address is not a Tailscale name: no device will reach it. */
export const TAILNET_ADDRESS_WRONG_TEXT =
  'That is not a Tailscale address, but this server is set up to be reached over your tailnet, so no tablet or phone will reach it. Set the address to this machine’s Tailscale name, as the steps below say.';
/** Funnel is on: what that changes (ADR 0079 D-3). */
export const TAILNET_FUNNEL_TEXT =
  'Funnel is on, so this address is on the public internet too: anybody can reach it, and the admin pages are not served there. Riders do not need the Tailscale app.';
/** The server is set up for a Cloudflare tunnel: nothing for this step to do. */
export const TAILNET_CLOUDFLARE_TEXT =
  'Nothing to do here: this server is reached through a Cloudflare tunnel on your own domain, not a tailnet. Press Next step.';
/** The settings name no way in for other devices. */
export const TAILNET_NO_PATH_TEXT =
  'This server’s settings do not say how other devices reach it, so this step cannot check your tailnet. The guide’s step 3 says how to choose; you can carry on and come back.';
/** No card can be drawn (no keys opened): no device can be pointed at the address yet. */
export const TAILNET_NO_CARD_TEXT =
  'The server’s keys could not be read, so it cannot draw a card for this address and no device can be pointed at it yet. The server makes its keys when it starts with its secret key: restart it, then press Check now.';
/**
 * The keys are held but do not open at this address (`unreadable`): what a changed
 * OYL_INSTANCE_ORIGIN leaves, since the keys are wrapped under the address (`keys/wrap.ts`).
 * A device's first fetch fails, so nothing reaches the server until they are made again.
 */
export const TAILNET_KEYS_UNREADABLE_TEXT =
  'The server cannot open its keys at this address: they were made for another address, or under another secret key, so no tablet or phone can use it yet. Run the instance-key reset command in the steps below, then press Check now. Every device, your tablet too, must then scan the server’s new card.';

/** How riders join the tailnet (ADR 0079 D-2): never as the owner. */
export const TAILNET_RIDERS_HEADING = 'How each rider joins';
export const TAILNET_RIDERS_TEXT: readonly string[] = [
  'Invite each rider into your tailnet from the Tailscale admin console (Users, then Invite users), or share this machine with them (Machines, then this machine, then Share).',
  'Each rider installs the Tailscale app on their tablet or phone and signs in with their own Tailscale account.',
];
/** The one rule a rider must never break. */
export const TAILNET_NEVER_YOURS_TEXT =
  'Never sign a rider’s device in to your own Tailscale account: that gives it your identity across your whole tailnet, past the access rule below.';

/** Before the access rule, which the page draws after it in a block to copy. */
export const TAILNET_ACL_LEAD =
  'The access rule lets your own devices reach everything, and every other rider’s device reach this server’s port and nothing else. Paste it in the Tailscale admin console, under Access controls, if you have not already:';

/**
 * The tailnet access rule (ADR 0079 D-2), as `docs/self-hosting/home-machine.md`
 * step 3a.2 gives it: the owner reaches everything, every other member's or
 * shared device only `tcp:443` on the instance's tag.
 */
export const TAILNET_ACL = `{
  "tagOwners": { "tag:onyourleft": ["autogroup:owner"] },
  "grants": [
    { "src": ["autogroup:owner"], "dst": ["*"], "ip": ["*"] },
    {
      "src": ["autogroup:member", "autogroup:shared"],
      "dst": ["tag:onyourleft"],
      "ip": ["tcp:443"]
    }
  ]
}`;

/** The heading over changing the address. */
export const TAILNET_CHANGE_HEADING = 'Changing this server’s address';
/**
 * Said BEFORE anything about how to change an address that is already set
 * (ADR 0079 D-8, ADR 0069 D-1): what every device and every passkey loses.
 */
export const TAILNET_CHANGE_WARNING =
  'Before you change it: the server’s keys belong to its address, so it must make new ones, which gives it a new identity. Every device that uses this server, your tablet too, must scan the server’s new card afterwards, and every passkey made for the old address stops working until you make one for the new address.';
/** After the restart: the keys are made again for the new address (`unreadable` until then). */
const TAILNET_CHANGE_RESET_LINE: SetupHowLine = {
  text: 'Then run this beside compose.yaml: the server cannot open its old keys at the new address, so this makes new ones.',
  commands: [SETUP_COMMANDS.instanceKeyReset],
};
const TAILNET_CHANGE_CHECK_LINE: SetupHowLine = {
  text: 'Then press Check now on this page: it shows the address the running server read back, and whether a device can fetch its keys there.',
  commands: [],
};
/** How to change it on a tailnet, for whoever wants the setting's name and the command. */
export const TAILNET_CHANGE_EXPERT_LINES: readonly SetupHowLine[] = [
  {
    text: 'Set OYL_INSTANCE_ORIGIN in .env to https:// and this machine’s Tailscale name, for example https://onyourleft.your-tailnet.ts.net with your own tailnet’s name.',
    commands: [],
  },
  {
    text: 'Keep COMPOSE_PROFILES=tailscale and OYL_INSTANCE_REMOTE_PATH=tailnet (or funnel) and OYL_INSTANCE_CLIENT_ADDRESS_HEADER=x-forwarded-for.',
    commands: [],
  },
  {
    text: 'Run bash deploy.sh beside compose.yaml. It prints Tailscale’s sign-in link if the machine is not signed in yet, and checks that the address the server runs with is the one Tailscale answers on: it says both if they differ.',
    commands: [],
  },
  TAILNET_CHANGE_RESET_LINE,
  TAILNET_CHANGE_CHECK_LINE,
];
/** The same on a Cloudflare tunnel: an address on the owner's domain, nothing a tailnet needs. */
export const TAILNET_CHANGE_CLOUDFLARE_LINES: readonly SetupHowLine[] = [
  {
    text: 'Set OYL_INSTANCE_ORIGIN in .env to https:// and the new name on your own domain that your Cloudflare tunnel serves, and give the tunnel that name as the guide’s step 3b says.',
    commands: [],
  },
  { text: 'Run bash deploy.sh beside compose.yaml.', commands: [] },
  TAILNET_CHANGE_RESET_LINE,
  TAILNET_CHANGE_CHECK_LINE,
];

// --- passkey (ADR 0080 D-7, Q-6)

export const PASSKEY_STEP_LEAD =
  'This step is optional, and you can skip it. Your tablet already owns this server, and you run the server from the app on it.';
export const PASSKEY_STEP_LATER =
  'A passkey lets you sign in to the server’s admin pages on this computer without a code. You can add one later, from the admin pages, whenever you want it.';
/** How to add one, after the setup: `adminAddress` is the admin pages' address on this machine. */
export function passkeyStepHow(adminAddress: string): readonly SetupHowLine[] {
  return [
    {
      text: 'Turn the admin pages on: set OYL_INSTANCE_ADMIN_PAGES=on in .env, then run:',
      commands: [SETUP_COMMANDS.adminPagesOn],
    },
    {
      text: `Run this on this machine, and sign in at ${adminAddress} with the code it prints:`,
      commands: [SETUP_COMMANDS.adminCode],
    },
    {
      text: 'On the Passkeys page, add a passkey. It reads every page, and changes nothing until you confirm it: the first command shows its id, the second confirms it.',
      commands: [SETUP_COMMANDS.adminPasskeysList, SETUP_COMMANDS.adminPasskeysConfirm],
    },
  ];
}

// --- the emergency kit (ADR 0080 D-4)

export const KIT_STEP_LEAD =
  'The emergency kit is one small text file. With it and a backup, you can bring this server back on a new computer if this one is lost.';
export const KIT_KEEP_TEXT =
  'Keep the kit in a password manager, or print it. Never keep it beside the backups: whoever holds the kit and a backup can pretend to be your server.';
export const KIT_DOWNLOAD_BUTTON = 'Download the emergency kit';
export const KIT_ONCE_TEXT =
  'It downloads once in each setup session: when your browser asks, save it. This page does not change after the download. After setup, you can download it again from the admin pages on this computer, once you have added a passkey there.';
export const KIT_TAKEN_TEXT =
  'The kit was downloaded in this session. Keep it safe, away from the backups.';
/**
 * The kit taken (#2858): what to do if the save was cancelled. A new setup
 * session downloads it again (ADR 0080 D-4's "once" is per session), and the
 * command that makes the code for one is below this sentence.
 */
export const KIT_AGAIN_TEXT =
  'If you cancelled the save or cannot find the file, start a new setup session: run this command on this machine, then type the new code on this page. A new session can download the kit once more.';
export const KIT_NONE_TEXT =
  'There is no emergency kit to download: every secret this server uses is in its settings file, .env, which is your copy of it.';

// --- backups (ADR 0080 D-6)

export const BACKUPS_STEP_LEAD =
  'Every six hours the server saves a backup in a folder on this computer, and copies it to a second place: the copy kept elsewhere, so a backup survives if this computer fails.';
export const BACKUPS_FOLDERS_TEXT =
  'This page cannot choose the two folders: they are set when the server is installed. It checks that both work.';
export const OFFBOX_RULE_TEXT =
  'The copy kept elsewhere must be on another drive or a network share, not this computer’s own disk. On Windows a USB stick does not work for it: the server cannot reach it, and every copy fails.';
export const BACKUPS_NONE_YET_TEXT =
  'No backup has run yet. Back up now to check that both folders work.';
export const BACKUPS_LAST_COPIED_TEXT =
  'Both folders work: the last backup was saved on this computer, and copied to the copy kept elsewhere.';
export const BACKUPS_LAST_COPY_FAILED_TEXT =
  'The last backup was saved on this computer, but it could not be copied to the copy kept elsewhere. Check that drive or share is plugged in and can be written to, then back up again.';
export const BACKUPS_LAST_NOT_CONFIGURED_TEXT =
  'The last backup was saved on this computer only: no place for the copy kept elsewhere has been set.';
export const BACKUPS_LAST_FAILED_TEXT =
  'The last backup failed: it could not be saved on this computer.';
/** Before {@link ranAgoText}: "The last backup ran 14 minutes ago." */
export const BACKUPS_LAST_RAN_TEXT = 'The last backup ran';
export const BACKUPS_WAITING_TEXT =
  'Waiting for the backup to run. It usually starts within 30 seconds: press Check now to see whether it has.';
/**
 * The newest backup was made before the tablet claimed the server (#2858):
 * it does not hold the owner's account, so "Back up now" is taken regardless
 * of the 15-minute gap until a backup made since the claim has run.
 */
export const BACKUPS_BEFORE_CLAIM_TEXT =
  'That backup was made before your tablet claimed this server, so it does not hold your account yet. Back up now to keep it.';
export const BACKUPS_TOO_SOON_TEXT =
  'A backup ran in the last 15 minutes, or one is already waiting, so no new one was asked for.';
export const BACK_UP_NOW_STEP_BUTTON = 'Back up now';
/** The command-line details: what sets the two folders, and how to check the service. */
export const BACKUPS_EXPERT_LINES: readonly SetupHowLine[] = [
  {
    text: 'The folder on this computer is OYL_BACKUP_DIR in .env, and the copy kept elsewhere is OYL_OFFBOX_DIR.',
    commands: [],
  },
  {
    text: 'To change one, edit its line in .env and run the deploy again: the backup service is started with them.',
    commands: [],
  },
  {
    text: 'To check the backup service is running, run this beside compose.yaml:',
    commands: [SETUP_COMMANDS.backupStatus],
  },
];

// --- registration (ADR 0080 D-6, Q-3)

export const REGISTRATION_STEP_LEAD =
  'Choose who may make an account on this server. You can change it later.';
export const REGISTRATION_STEP_LEGEND = 'Who may join';
/** One button: the choice is saved, and the setup moves on. */
export const REGISTRATION_SAVE_BUTTON = 'Save and go to the next step';

/**
 * Each registration mode in the setup's own plain words. The stored values
 * stay the instance's (`approval`, `invite`, `open`, `closed`); the app's
 * Operate words for them are `accounts.ts`'s.
 */
export const SETUP_REGISTRATION_MODE_TEXT: Readonly<
  Record<
    'open' | 'approval' | 'invite' | 'closed',
    { readonly short: string; readonly meaning: string }
  >
> = {
  open: {
    short: 'Anyone can join',
    meaning: 'Anyone who has this server’s address can make an account and ride at once.',
  },
  approval: {
    short: 'I approve each new rider',
    meaning:
      'A new rider’s account waits until you approve it in the app. Until then, other riders cannot see it.',
  },
  invite: {
    short: 'Only people I invite',
    meaning:
      'A new rider needs an invite you make in the app. Each invite works once, for seven days.',
  },
  closed: {
    short: 'Nobody new',
    meaning: 'Nobody new can join. Riders who already have an account keep it.',
  },
};

// --- invite (ADR 0080 D-7)

export const INVITE_STEP_LEAD =
  'Make one invite for a rider: a code they scan with the On Your Left app. It works once, for seven days.';
/** Above the invite QR, in place of the admin page's own words (#2783). */
export const INVITE_CODE_LEAD =
  'Scan this with the On Your Left app on the new rider’s phone or tablet. In the app, open More, then Instance, and use its own scanner, not the camera app.';
export const INVITE_MAKE_BUTTON = 'Make an invite';
export const INVITE_TAKEN_TEXT =
  'This setup has made its one invite. You can make more later, from the app.';
/**
 * Before the owner's tablet has signed in. The app does not sign in by itself
 * after the claim, so this is an instruction, not a fault.
 */
export const INVITE_NO_OWNER_TEXT =
  'One more thing on your tablet first: an invite is made from your account, and your tablet has not signed in to this server yet. In the On Your Left app on your tablet, open More, then Instance, and connect to this server. Then come back to this page.';
export const INVITE_CHECK_AGAIN_LINK = 'Check again';
export const INVITE_NOT_INVITE_MODE_TEXT =
  'You chose to let riders join without an invite. The code still helps: it carries this server’s address and card, so the rider’s app trusts it at once.';

// --- AI write-ups (#2792, ADR 0046)
//
// The step lists what the owner's own Ollama reports, and downloads the model
// whose name the owner types. ⚠️ Since #2869 (ADR 0086) it names ONE model, the
// recommended download below, and nowhere else does: ADR 0046's amendment of
// 2026-11-14, point 8, and ADR 0031 D-4 still hold for every other screen.

export const AI_STEP_LEAD =
  'This step is optional, and you can skip it. An AI write-up is a short written summary of a ride. It is made on this computer, by a model that a free program called Ollama runs, so nothing about a ride leaves your server for it. Everything else works the same without it.';
/** Before the model's name: write-ups are on, read as the next write-up will read it. */
export const AI_ON_TEXT = 'AI write-ups are on. They run on this model:';
/** No Ollama answered: one sentence, and the step is skipped with Next step. */
export const AI_NO_SERVER_TEXT = 'Ollama was not found on this computer, so AI write-ups stay off.';
export const AI_SKIP_TEXT =
  'Press Next step to carry on without them. If you have just started Ollama, press Look again.';
/** No Ollama answered, and write-ups already run on a model set elsewhere. */
export const AI_NO_LIST_TEXT =
  'Ollama was not found on this computer, so this page cannot list or download models.';
export const AI_LOOK_AGAIN_BUTTON = 'Look again';
export const AI_SERVER_TEXT = 'Ollama is running on this computer.';
/** The command-line details: how to run Ollama beside the server, and where the step looks. */
export const AI_EXPERT_LINES: readonly string[] = [
  'To run Ollama beside the server, set COMPOSE_PROFILES=analysis in .env, then run docker compose up -d ollama.',
  'This step looks at the address in OYL_INSTANCE_ANALYSIS_MODEL_URL if one is set, then at http://ollama:11434, http://host.docker.internal:11434 and http://127.0.0.1:11434.',
  'Ollama has no sign-in of its own: never open its port to the network.',
];

export const AI_MODELS_HEADING = 'Models Ollama has on this computer';
export const AI_NO_MODELS_TEXT = 'Ollama has no models yet. Download one below.';
/** The button that chooses a listed model: "Use name:tag". */
export function aiUseButton(model: string): string {
  return `Use ${model}`;
}
export const AI_IN_USE_TEXT = 'Write-ups run on this model.';
export const AI_NO_TOOLS_TEXT =
  'Write-ups cannot run on this model: it cannot call tools, which they need.';
export const AI_USE_HINT =
  'Using a model loads it once, to see how well it fits your graphics card. That can take a minute: wait for the page.';
export const AI_USE_REFUSED_TEXT =
  'That model could not be used: Ollama no longer lists it, or the server did not take the setting. Nothing was changed.';

/**
 * How well a model fits the graphics card, in plain words: of a model Ollama
 * has loaded, as it reports it. It is never guessed from the file's size.
 */
export function aiFitText(gpu: OperateGpuFit, percent: number | null): string {
  switch (gpu) {
    case 'all':
      return 'It fits in the graphics card’s memory, so it runs at full speed.';
    case 'part':
      return `Only ${String(percent ?? 0)} % of it fits in the graphics card’s memory, so it runs slowly. A smaller model would be faster.`;
    case 'none':
      return 'None of it is in a graphics card’s memory, so it runs on the processor, slowly.';
    case 'not-loaded':
      return 'How well it fits the graphics card is not known until it has been loaded.';
    case 'not-reported':
    case 'not-known':
      return 'Ollama did not say how well it fits the graphics card.';
  }
}

/**
 * The one model the step recommends (#2869, ADR 0086 D-1): Apache-2.0, can call
 * tools, 5.2 GB in Ollama's library (`Q4_K_M`), read 2026-11-19. Change it only
 * with ADR 0086's D-1 read again on the day.
 */
export const AI_RECOMMENDED_MODEL = 'qwen3:8b';
/** Its download's size, 5.2 GB in Ollama's library, in words: whole gigabytes, as no fixed sentence here carries a digit run with a point (ADR 0004 D). */
export const AI_RECOMMENDED_SIZE_TEXT = 'about 5 GB';
/** The one press that downloads it (ADR 0086 D-3). */
export const AI_RECOMMENDED_BUTTON = `Download the recommended model (${AI_RECOMMENDED_MODEL}, ${AI_RECOMMENDED_SIZE_TEXT})`;
/** Why it is the one, under its button. */
export const AI_RECOMMENDED_HINT =
  'It can call tools, which write-ups need, and fits a graphics card with 8 GB of memory. It is free to use, under an open-source licence. To download another model instead, type its name below.';
/**
 * Before the list, when Ollama already has a model that fits (ADR 0086 D-4):
 * nothing needs downloading, and that model is the list's first.
 */
export const AI_INSTALLED_FIRST_TEXT =
  'A model already on this computer can run write-ups, so nothing needs downloading. It is first in the list below.';

export const AI_PULL_HEADING = 'Download a model';
export const AI_PULL_LABEL = 'Model to download';
export const AI_PULL_HINT =
  'Type a model’s name as Ollama’s library lists it: a name, or name:tag. Choose one that can call tools, and that is smaller than your graphics card’s memory. A model is several gigabytes, so the download can take a while.';
export const AI_PULL_BUTTON = 'Download this model';
export const AI_BAD_NAME_TEXT =
  'That is not a model’s name. Type it as Ollama’s library lists it: a name, or name:tag.';
/**
 * A download that is running, from the bytes Ollama has counted so far. It
 * says no name and nothing Ollama said: only how far it has got.
 */
export function aiPullRunningText(completedBytes: number, totalBytes: number): string {
  const checkNow = 'Press Check now to see how far it has got.';
  if (totalBytes <= 0) return `Downloading the model: it has just started. ${checkNow}`;
  const percent = Math.min(99, Math.floor((completedBytes / totalBytes) * 100));
  return `Downloading the model: ${String(percent)} % so far, ${bytesText(completedBytes)} of ${bytesText(totalBytes)}. ${checkNow}`;
}
/** One sentence for a download that did not finish, whatever Ollama said of it. */
export const AI_PULL_FAILED_TEXT =
  'The download did not finish. Check that the name is spelled as Ollama lists it, that this computer is online and that its disk has room, then try again.';
export const AI_PULL_DONE_TEXT = 'The download finished. The model is in the list on this page.';

// --- finish (ADR 0080 D-7)

export const FINISH_LEAD = 'Here is where your server stands:';
export const FINISH_CLOSE_TEXT =
  'Finishing closes this setup page for good: it will not open again, even after a restart.';
export const FINISH_BUTTON = 'Finish setup';
export const FINISHED_HEADING = 'Setup is finished';
export const FINISHED_TEXT =
  'The setup page is closed, and the setup code file is gone. Run the server from the app on your tablet.';

/** What the finish step reports, each in plain words. */
export interface SetupSummary {
  readonly ownerClaimed: boolean;
  /** The kit, in this setup: downloaded, not, or there is none to download. */
  readonly kit: 'downloaded' | 'not-downloaded' | 'none';
  /** The newest backup: both folders worked, this computer only, failed, or none yet. */
  readonly backups: 'working' | 'this-computer-only' | 'failed' | 'none-yet';
  readonly mode: 'open' | 'approval' | 'invite' | 'closed';
  /** Invites this setup made. */
  readonly invites: number;
  /** Whether a write-up would run on this computer's model now (#2792). */
  readonly ai: 'on' | 'off';
}

/** The finish step's list: one plain sentence per thing an owner wants to know. */
export function setupSummaryLines(summary: SetupSummary): readonly string[] {
  return [
    summary.ownerClaimed
      ? 'Owner: your tablet owns this server.'
      : 'Owner: nobody has claimed this server yet.',
    {
      downloaded: 'Emergency kit: downloaded.',
      'not-downloaded':
        'Emergency kit: not downloaded. You can download it later from the admin pages on this computer, once you have added a passkey there.',
      none: 'Emergency kit: none needed, every secret is in .env.',
    }[summary.kit],
    {
      working: 'Backups: working, on this computer and in the copy kept elsewhere.',
      'this-computer-only':
        'Backups: on this computer only. The copy kept elsewhere is not working.',
      failed: 'Backups: not working. The last backup failed.',
      'none-yet': 'Backups: not checked yet. No backup has run.',
    }[summary.backups],
    `Who may join: ${SETUP_REGISTRATION_MODE_TEXT[summary.mode].short}.`,
    summary.invites === 0 ? 'Invites made: none.' : `Invites made: ${String(summary.invites)}.`,
    summary.ai === 'on'
      ? 'AI write-ups: on, made on this computer.'
      : 'AI write-ups: off. Everything else works without them.',
  ];
}
