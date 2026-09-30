// SPDX-License-Identifier: AGPL-3.0-or-later

import { DEFAULT_BLOBS_PATH, DEFAULT_DATABASE_PATH } from '../server-config.ts';
import {
  backup,
  CommandError,
  migrate,
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
  env: { readonly database?: string | undefined; readonly blobs?: string | undefined },
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
        report = await restore(paths, snapshot, { force });
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
