// SPDX-License-Identifier: AGPL-3.0-or-later

import { DEFAULT_BLOBS_PATH, DEFAULT_DATABASE_PATH } from '../server-config.ts';
import {
  backup,
  CommandError,
  instanceKey,
  migrate,
  modelKeyClear,
  modelKeySet,
  modelKeyStatus,
  restore,
  roomOpen,
  verify,
  type DataPaths,
} from './commands.ts';

const USAGE = `usage: node src/operator/cli.ts <command>
  migrate
  backup <directory> [--keep N] [--copy-to <directory>]
  restore <snapshot directory> [--force]
  verify
  room-open <roomId> --kind ride|race --length <metres> [--grade <percent>] [--position hoods|drops|upright] [--countdown <ms>]
  model-key set --url https://… --model <name>   (the key on standard input)
  model-key status
  model-key clear
  instance-key init | show | rotate [--drop-old] [--serial-above <n>] | rotate-identity [--compromised] | reset
`;

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}

function has(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

/** Runs one command, prints its JSON report, and answers the exit code. */
export async function runCommand(
  argv: readonly string[],
  env: {
    readonly database?: string | undefined;
    readonly blobs?: string | undefined;
    /** `OYL_INSTANCE_SECRET_KEY`, for `model-key` (#1097). */
    readonly secret?: string | undefined;
    /** `OYL_INSTANCE_OWNER_KEY`: whose athlete `model-key set` holds the key for (#1097). */
    readonly ownerKey?: string | undefined;
    /** `OYL_INSTANCE_ORIGIN`: what the instance's own keys are bound to (#1189). */
    readonly origin?: string | undefined;
    /** Standard input, read whole: where `model-key set` takes the key from. */
    readonly readStandardInput?: () => Promise<string>;
  },
): Promise<number> {
  const paths: DataPaths = {
    database: env.database?.trim() || DEFAULT_DATABASE_PATH,
    blobs: env.blobs?.trim() || DEFAULT_BLOBS_PATH,
  };
  const args = [...argv];
  const command = args.shift();
  try {
    let report: unknown;
    switch (command) {
      case 'migrate':
        report = await migrate(paths);
        break;
      case 'backup': {
        const keep = flag(args, '--keep');
        const copyTo = flag(args, '--copy-to');
        const destination = args[0];
        if (destination === undefined) throw new CommandError(USAGE);
        report = await backup(paths, destination, {
          ...(keep === undefined ? {} : { keep: Number(keep) }),
          ...(copyTo === undefined ? {} : { copyTo }),
        });
        break;
      }
      case 'restore': {
        const force = has(args, '--force');
        const snapshot = args[0];
        if (snapshot === undefined) throw new CommandError(USAGE);
        report = await restore(paths, snapshot, {
          force,
          keys: { secret: env.secret, origin: env.origin },
        });
        break;
      }
      case 'verify':
        report = await verify(paths);
        break;
      case 'room-open': {
        const kind = flag(args, '--kind') ?? '';
        const length = Number(flag(args, '--length'));
        const grade = flag(args, '--grade');
        const position = flag(args, '--position');
        const countdown = flag(args, '--countdown');
        const roomId = args[0];
        if (roomId === undefined) throw new CommandError(USAGE);
        report = await roomOpen(paths, roomId, {
          kind,
          lengthMetres: length,
          ...(grade === undefined ? {} : { gradePercent: Number(grade) }),
          ...(position === undefined ? {} : { position }),
          ...(countdown === undefined ? {} : { countdownMs: Number(countdown) }),
        });
        break;
      }
      case 'model-key': {
        const action = args.shift();
        if (action === 'set') {
          const url = flag(args, '--url');
          const model = flag(args, '--model');
          // Anything else on the line is refused, and never echoed: it may be
          // the key itself, which belongs on standard input (#1097).
          if (args.length > 0) {
            throw new CommandError(
              'model-key set reads the key from standard input, never from the command line. Nothing was written.',
            );
          }
          if (url === undefined || model === undefined) throw new CommandError(USAGE);
          report = await modelKeySet(paths, {
            url,
            model,
            input: await (env.readStandardInput ?? (() => Promise.resolve('')))(),
            secret: env.secret,
            ownerKey: env.ownerKey,
          });
        } else if (action === 'status' && args.length === 0) {
          report = await modelKeyStatus(paths, env.secret);
        } else if (action === 'clear' && args.length === 0) {
          report = await modelKeyClear(paths);
        } else {
          throw new CommandError(USAGE);
        }
        break;
      }
      case 'instance-key': {
        const action = args.shift();
        const keys = { secret: env.secret, origin: env.origin };
        if (action === 'rotate') {
          const dropOld = has(args, '--drop-old');
          const above = flag(args, '--serial-above');
          if (args.length > 0) throw new CommandError(USAGE);
          report = await instanceKey(
            paths,
            {
              action,
              dropOld,
              ...(above === undefined
                ? {}
                : { serialAbove: /^[0-9]+$/.test(above) ? Number(above) : Number.NaN }),
            },
            keys,
          );
        } else if (action === 'rotate-identity') {
          const compromised = has(args, '--compromised');
          if (args.length > 0) throw new CommandError(USAGE);
          report = await instanceKey(paths, { action, compromised }, keys);
        } else if (
          (action === 'init' || action === 'show' || action === 'reset') &&
          args.length === 0
        ) {
          report = await instanceKey(paths, { action }, keys);
        } else {
          throw new CommandError(USAGE);
        }
        break;
      }
      default:
        process.stderr.write(USAGE);
        return 2;
    }
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return 0;
  } catch (error) {
    const message =
      error instanceof CommandError
        ? error.message
        : `the command failed (${error instanceof Error ? error.name : 'unknown'})`;
    process.stderr.write(`${message}\n`);
    return 1;
  }
}
