import pg from 'pg';
import type { Profile } from './config.js';

const { Client } = pg;
export type PgClient = pg.Client;

export async function connect(profile: Profile): Promise<PgClient> {
  const client = new Client({
    host: profile.host,
    port: profile.port ?? 5432,
    database: profile.database,
    user: profile.user,
    password: profile.password,
  });
  await client.connect();
  return client;
}

export function describeProfile(p: Profile): string {
  return `${p.user}@${p.host}:${p.port ?? 5432}/${p.database}`;
}

export async function metaTableExists(
  client: PgClient,
  metaTable: string,
): Promise<boolean> {
  const r = await client.query<{ t: string | null }>(
    `SELECT to_regclass($1) AS t`,
    [`"${metaTable}"`],
  );
  return r.rows[0]?.t !== null;
}

export async function listAppliedMigrations(
  client: PgClient,
  metaTable: string,
): Promise<string[]> {
  if (!(await metaTableExists(client, metaTable))) return [];
  const r = await client.query<{ name: string }>(
    `SELECT name FROM "${metaTable}" ORDER BY name`,
  );
  return r.rows.map((row) => row.name);
}

export async function listPublicTables(client: PgClient): Promise<string[]> {
  const r = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  return r.rows.map((row) => row.table_name);
}
