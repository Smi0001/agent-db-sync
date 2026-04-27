import * as p from '@clack/prompts';
import { loadConfig, getProfile } from '../config.js';
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
  const metaTable = String(
    args.flags.meta ?? config.migrations?.metaTable ?? 'SequelizeMeta',
  );

  if (fromName === toName) {
    throw new Error('--from and --to must differ.');
  }

  p.intro(`Diff ${fromName} → ${toName}`);
  const fromProfile = getProfile(config, fromName);
  const toProfile = getProfile(config, toName);

  const spinner = p.spinner();
  spinner.start('Connecting...');
  const [from, to] = await Promise.all([connect(fromProfile), connect(toProfile)]);
  spinner.stop('Connected.');

  try {
    spinner.start('Comparing migrations...');
    const [fromMigs, toMigs] = await Promise.all([
      listAppliedMigrations(from, metaTable),
      listAppliedMigrations(to, metaTable),
    ]);
    spinner.stop('Migrations compared.');

    const onlyInFrom = fromMigs.filter((m) => !toMigs.includes(m));
    const onlyInTo = toMigs.filter((m) => !fromMigs.includes(m));

    console.log('');
    console.log(`From  ${describeProfile(fromProfile)}  (${fromMigs.length} applied)`);
    console.log(`To    ${describeProfile(toProfile)}  (${toMigs.length} applied)`);
    console.log('');
    if (onlyInFrom.length === 0 && onlyInTo.length === 0) {
      console.log('Migrations are in sync.');
    } else {
      if (onlyInFrom.length) {
        console.log(`Only in ${fromName} (${onlyInFrom.length}):`);
        for (const m of onlyInFrom) console.log(`  + ${m}`);
      }
      if (onlyInTo.length) {
        console.log(`Only in ${toName} (${onlyInTo.length}):`);
        for (const m of onlyInTo) console.log(`  - ${m}`);
      }
    }

    spinner.start('Comparing tables (public schema)...');
    const [fromTables, toTables] = await Promise.all([
      listPublicTables(from),
      listPublicTables(to),
    ]);
    spinner.stop('Tables compared.');

    const onlyInFromT = fromTables.filter((t) => !toTables.includes(t));
    const onlyInToT = toTables.filter((t) => !fromTables.includes(t));

    console.log('');
    if (onlyInFromT.length === 0 && onlyInToT.length === 0) {
      console.log('Table lists match.');
    } else {
      if (onlyInFromT.length) {
        console.log(`Tables only in ${fromName}:`);
        for (const t of onlyInFromT) console.log(`  + ${t}`);
      }
      if (onlyInToT.length) {
        console.log(`Tables only in ${toName}:`);
        for (const t of onlyInToT) console.log(`  - ${t}`);
      }
    }

    p.outro('Done.');
  } finally {
    await from.end();
    await to.end();
  }
}
