import * as p from '@clack/prompts';
import { spawn } from 'node:child_process';
import { loadConfig, getProfile } from '../config.js';
import type { Profile } from '../config.js';
import {
  connect,
  describeProfile,
  listAppliedMigrations,
  listPublicTables,
} from '../db.js';
import type { Args } from '../args.js';

export async function run(args: Args): Promise<void> {
  const { config } = await loadConfig();
  const fromName = String(args.flags.from ?? 'sandman');
  const toName = String(args.flags.to ?? 'local');
  const dryRun = args.flags['dry-run'] === true;
  const yes = args.flags.yes === true;
  const metaTable = String(
    args.flags.meta ?? config.migrations?.metaTable ?? 'SequelizeMeta',
  );

  if (fromName === toName) throw new Error('--from and --to must differ.');

  const fromProfile = getProfile(config, fromName);
  const toProfile = getProfile(config, toName);

  p.intro(`Sync ${fromName} → ${toName}${dryRun ? ' (dry run)' : ''}`);
  console.log(`From: ${describeProfile(fromProfile)}`);
  console.log(`To:   ${describeProfile(toProfile)}`);

  const looksLocal = ['localhost', '127.0.0.1', '::1', ''].includes(toProfile.host);
  if (!looksLocal && !yes) {
    throw new Error(
      `Refusing to sync into "${toProfile.host}" — that is not localhost. Pass --yes to override.`,
    );
  }

  await showDiff(fromProfile, toProfile, fromName, toName, metaTable);

  if (dryRun) {
    p.outro('Dry run — no changes made.');
    return;
  }

  const ok = await p.confirm({
    message: `This will DROP and REPLACE every object in database "${toProfile.database}" on ${describeProfile(toProfile)}. Continue?`,
    initialValue: false,
  });
  if (p.isCancel(ok) || !ok) {
    p.cancel('Aborted.');
    return;
  }

  const spinner = p.spinner();
  spinner.start('Running pg_dump | psql ...');
  try {
    await pgDumpRestore(fromProfile, toProfile);
    spinner.stop('Restore complete.');
  } catch (err) {
    spinner.stop('Restore failed.');
    throw err;
  }

  console.log('');
  console.log(
    `Local DB now mirrors ${fromName}. If your project has migrations beyond what ${fromName} already has, run them from your project root, e.g.:`,
  );
  console.log('  npx sequelize-cli db:migrate');
  console.log(
    `If a migration fails with "already exists", run \`agent-db-sync reconcile --profile ${toName}\` to record it in "${metaTable}".`,
  );

  p.outro('Sync complete.');
}

async function showDiff(
  fromProfile: Profile,
  toProfile: Profile,
  fromName: string,
  toName: string,
  metaTable: string,
): Promise<void> {
  const spinner = p.spinner();
  spinner.start('Inspecting both databases...');
  const [from, to] = await Promise.all([connect(fromProfile), connect(toProfile)]);
  try {
    const [fromMigs, toMigs, fromTables, toTables] = await Promise.all([
      listAppliedMigrations(from, metaTable),
      listAppliedMigrations(to, metaTable),
      listPublicTables(from),
      listPublicTables(to),
    ]);
    spinner.stop('Inspection done.');

    const migDelta =
      fromMigs.filter((m) => !toMigs.includes(m)).length +
      toMigs.filter((m) => !fromMigs.includes(m)).length;
    const tableDelta =
      fromTables.filter((t) => !toTables.includes(t)).length +
      toTables.filter((t) => !fromTables.includes(t)).length;

    console.log('');
    console.log(
      `Migrations: ${fromName}=${fromMigs.length}, ${toName}=${toMigs.length}, delta=${migDelta}`,
    );
    console.log(
      `Tables:     ${fromName}=${fromTables.length}, ${toName}=${toTables.length}, delta=${tableDelta}`,
    );
    if (migDelta === 0 && tableDelta === 0) {
      console.log('(databases already look identical at the surface level)');
    }
  } finally {
    await from.end();
    await to.end();
  }
}

async function pgDumpRestore(from: Profile, to: Profile): Promise<void> {
  const dumpArgs = [
    '--host', from.host,
    '--port', String(from.port ?? 5432),
    '--username', from.user,
    '--dbname', from.database,
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-acl',
  ];
  const psqlArgs = [
    '--host', to.host,
    '--port', String(to.port ?? 5432),
    '--username', to.user,
    '--dbname', to.database,
    '--quiet',
    '--set', 'ON_ERROR_STOP=0',
  ];

  await new Promise<void>((res, rej) => {
    const dump = spawn('pg_dump', dumpArgs, {
      env: { ...process.env, PGPASSWORD: from.password ?? '' },
    });
    const psql = spawn('psql', psqlArgs, {
      env: { ...process.env, PGPASSWORD: to.password ?? '' },
    });

    let dumpErr = '';
    let psqlErr = '';
    dump.stderr.on('data', (d) => {
      dumpErr += d.toString();
    });
    psql.stderr.on('data', (d) => {
      psqlErr += d.toString();
    });

    dump.stdout.pipe(psql.stdin);

    dump.on('error', rej);
    psql.on('error', rej);

    let dumpExit: number | null = null;
    let psqlExit: number | null = null;
    const finish = () => {
      if (dumpExit === null || psqlExit === null) return;
      if (dumpExit === 0 && psqlExit === 0) {
        res();
      } else {
        rej(
          new Error(
            `pg_dump exited ${dumpExit}, psql exited ${psqlExit}\n` +
              `pg_dump stderr:\n${dumpErr}\n` +
              `psql stderr:\n${psqlErr}`,
          ),
        );
      }
    };
    dump.on('exit', (code) => {
      dumpExit = code ?? 1;
      finish();
    });
    psql.on('exit', (code) => {
      psqlExit = code ?? 1;
      finish();
    });
  });
}
