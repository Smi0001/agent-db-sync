import * as p from '@clack/prompts';
import { readdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, getProfile, resolveConfigRelative } from '../config.js';
import {
  connect,
  describeProfile,
  listAppliedMigrations,
  metaTableExists,
} from '../db.js';
import type { Args } from '../args.js';

export async function run(args: Args): Promise<void> {
  const { config, path: configPath } = await loadConfig();
  const profileName = String(args.flags.profile ?? 'local');
  const metaTable = String(
    args.flags.meta ?? config.migrations?.metaTable ?? 'SequelizeMeta',
  );

  const dir = await resolveMigrationsDir(args, config, configPath);
  if (!dir) return;

  p.intro(`Reconcile "${metaTable}" on ${profileName}`);

  const profile = getProfile(config, profileName);
  const client = await connect(profile);
  console.log(`Connected: ${describeProfile(profile)}`);
  console.log(`Migrations dir: ${dir}`);
  console.log(`Meta table: "${metaTable}"`);

  try {
    if (!(await metaTableExists(client, metaTable))) {
      throw new Error(
        `Meta table "${metaTable}" does not exist. Run sequelize once to create it (or pass --meta).`,
      );
    }

    const applied = new Set(await listAppliedMigrations(client, metaTable));
    const files = (await readdir(dir))
      .filter((f) => /\.(js|cjs|ts)$/.test(f))
      .sort();

    const pending = files.filter((f) => !applied.has(f));
    const orphans = [...applied].filter((m) => !files.includes(m));

    console.log('');
    console.log(`Files in dir:                ${files.length}`);
    console.log(`Recorded in meta table:      ${applied.size}`);
    console.log(`Pending (file, not recorded): ${pending.length}`);
    console.log(`Orphan (recorded, no file):   ${orphans.length}`);

    if (orphans.length > 0) {
      console.log('\nOrphan entries (left untouched — review manually):');
      for (const m of orphans) console.log(`  ! ${m}`);
    }

    if (pending.length === 0) {
      p.outro('Nothing pending. All migration files are recorded.');
      return;
    }

    console.log('');
    console.log(
      'Use this when the change in a migration was already applied to the DB (manual SQL, prior tool, restored snapshot, etc.) but its name is not in the meta table.',
    );

    const selected = await p.multiselect<{ value: string; label: string }[], string>({
      message: 'Mark which pending migrations as applied?',
      options: pending.map((f) => ({ value: f, label: f })),
      required: false,
    });

    if (p.isCancel(selected)) {
      p.cancel('Aborted.');
      return;
    }

    const names = selected as string[];
    if (!names || names.length === 0) {
      p.outro('No changes.');
      return;
    }

    const confirm = await p.confirm({
      message: `Insert ${names.length} row(s) into "${metaTable}"?`,
      initialValue: true,
    });
    if (p.isCancel(confirm) || !confirm) {
      p.cancel('Aborted.');
      return;
    }

    await client.query('BEGIN');
    try {
      for (const name of names) {
        await client.query(
          `INSERT INTO "${metaTable}" (name) VALUES ($1) ON CONFLICT DO NOTHING`,
          [name],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }

    p.outro(`Marked ${names.length} migration(s) as applied.`);
  } finally {
    await client.end();
  }
}

function isUsableDir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

async function resolveMigrationsDir(
  args: Args,
  config: { migrations?: { dir?: string } },
  configPath: string,
): Promise<string | null> {
  if (args.flags.dir) {
    const fromFlag = resolve(process.cwd(), String(args.flags.dir));
    if (!isUsableDir(fromFlag)) {
      throw new Error(`--dir not a directory: ${fromFlag}`);
    }
    return fromFlag;
  }

  if (config.migrations?.dir) {
    const fromConfig = resolveConfigRelative(configPath, config.migrations.dir);
    if (isUsableDir(fromConfig)) return fromConfig;
    console.log(`Configured migrations.dir not found: ${fromConfig}`);
  }

  const entered = await p.text({
    message: 'Path to your Sequelize migrations directory?',
    placeholder: '/home/you/project/migrations',
    validate: (v) => {
      if (!v) return 'Required';
      const abs = resolve(process.cwd(), String(v));
      if (!existsSync(abs)) return `Not found: ${abs}`;
      if (!statSync(abs).isDirectory()) return `Not a directory: ${abs}`;
      return undefined;
    },
  });
  if (p.isCancel(entered)) {
    p.cancel('Aborted.');
    return null;
  }
  const chosen = resolve(process.cwd(), String(entered));
  console.log('');
  console.log(`Tip: add this to ${configPath} to skip the prompt next time:`);
  console.log(`  "migrations": { "dir": ${JSON.stringify(chosen)} }`);
  console.log('');
  return chosen;
}
