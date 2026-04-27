import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as p from '@clack/prompts';

const TEMPLATE = {
  profiles: {
    sandman: {
      host: 'sandman.example.internal',
      port: 5432,
      database: 'app',
      user: 'app',
      password: '${PG_SANDMAN_PASSWORD}',
    },
    uat: {
      host: 'uat.example.internal',
      port: 5432,
      database: 'app',
      user: 'app',
      password: '${PG_UAT_PASSWORD}',
    },
    local: {
      host: 'localhost',
      port: 5432,
      database: 'app_local',
      user: 'postgres',
      password: '${PG_LOCAL_PASSWORD}',
    },
  },
  migrations: {
    dir: './migrations',
    metaTable: 'SequelizeMeta',
  },
};

export async function run(): Promise<void> {
  const path = join(process.cwd(), '.dbsync.json');

  if (existsSync(path)) {
    const overwrite = await p.confirm({
      message: `${path} already exists. Overwrite?`,
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel('Aborted.');
      return;
    }
  }

  await writeFile(path, JSON.stringify(TEMPLATE, null, 2) + '\n', 'utf8');
  p.outro(
    `Wrote ${path}. Edit profiles to match your environments, set the referenced env vars, then run 'agent-db-sync diff'.`,
  );
}
