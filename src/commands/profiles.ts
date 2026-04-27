import { loadConfig } from '../config.js';
import { describeProfile } from '../db.js';

export async function run(): Promise<void> {
  const { config, path } = await loadConfig();
  console.log(`Config: ${path}\n`);
  const entries = Object.entries(config.profiles);
  if (entries.length === 0) {
    console.log('(no profiles defined)');
    return;
  }
  const width = Math.max(...entries.map(([n]) => n.length));
  for (const [name, profile] of entries) {
    console.log(`${name.padEnd(width)}  ${describeProfile(profile)}`);
  }
}
