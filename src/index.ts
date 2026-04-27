#!/usr/bin/env node
import { parseArgs } from './args.js';
import { run as runInit } from './commands/init.js';
import { run as runProfiles } from './commands/profiles.js';
import { run as runDiff } from './commands/diff.js';
import { run as runSync } from './commands/sync.js';
import { run as runReconcile } from './commands/reconcile.js';
import type { Args } from './args.js';

type Handler = (args: Args) => Promise<void>;

const COMMANDS: Record<string, Handler> = {
  init: runInit,
  profiles: runProfiles,
  diff: runDiff,
  sync: runSync,
  reconcile: runReconcile,
};

const HELP = `
agent-db-sync — sync remote Postgres databases to local with Sequelize migration reconciliation

Usage:
  agent-db-sync <command> [options]

Commands:
  init                          Write a .dbsync.json template in the current dir
  profiles                      List configured profiles
  diff [--from X --to Y]        Compare migrations + tables between two profiles
  sync [--from X --to Y]        Dump source and restore into target (DESTRUCTIVE)
                                Flags: --dry-run, --yes (allow non-localhost target)
  reconcile [--profile P]       Interactively mark pending migrations as applied
                                in the meta table (e.g. SequelizeMeta)

Common options:
  --meta <name>                 Override meta table name (default SequelizeMeta)
  --dir <path>                  Override migrations dir (reconcile only)
  -h, --help                    Show this help

Config search order:
  1. ./.dbsync.json
  2. ~/.smi/db-sync.json
Run 'agent-db-sync init' to create a template.

Examples:
  agent-db-sync diff --from sandman --to local
  agent-db-sync sync --from sandman --to local --dry-run
  agent-db-sync sync --from uat --to local
  agent-db-sync reconcile --profile local
`.trim();

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [first, ...rest] = argv;

  if (!first || first === '-h' || first === '--help' || first === 'help') {
    console.log(HELP);
    return;
  }

  const handler = COMMANDS[first];
  if (!handler) {
    console.error(`Unknown command: "${first}"\n`);
    console.error(HELP);
    process.exit(2);
  }

  await handler(parseArgs(rest));
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nError: ${msg}`);
  process.exit(1);
});
