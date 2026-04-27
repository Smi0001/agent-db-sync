import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import 'dotenv/config';

export interface Profile {
  host: string;
  port?: number;
  database: string;
  user: string;
  password?: string;
}

export interface MigrationsConfig {
  dir?: string;
  metaTable?: string;
}

export interface Config {
  profiles: Record<string, Profile>;
  migrations?: MigrationsConfig;
}

const SEARCH_PATHS = [
  () => join(process.cwd(), '.dbsync.json'),
  () => join(homedir(), '.smi', 'db-sync.json'),
];

export async function loadConfig(): Promise<{ config: Config; path: string }> {
  for (const get of SEARCH_PATHS) {
    const path = get();
    if (existsSync(path)) {
      const raw = await readFile(path, 'utf8');
      const parsed = JSON.parse(expandEnv(raw)) as Config;
      if (!parsed.profiles || typeof parsed.profiles !== 'object') {
        throw new Error(`Config at ${path} has no "profiles" map.`);
      }
      return { config: parsed, path };
    }
  }
  throw new Error(
    'No config found. Run `agent-db-sync init` to create one, or place a .dbsync.json in the current directory.',
  );
}

export function getProfile(cfg: Config, name: string): Profile {
  const p = cfg.profiles[name];
  if (!p) {
    throw new Error(
      `Unknown profile: "${name}". Available: ${Object.keys(cfg.profiles).join(', ') || '(none)'}`,
    );
  }
  return p;
}

function expandEnv(s: string): string {
  return s.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => process.env[name] ?? '');
}

export function resolveConfigRelative(configPath: string, p: string): string {
  if (isAbsolute(p)) return p;
  return resolve(dirname(configPath), p);
}
