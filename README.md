# @smi0001/agent-db-sync

Sync a remote Postgres database (sandman / UAT / staging) down to your laptop, and reconcile [Sequelize](https://sequelize.org/) migration state when things drift.

```bash
npx @smi0001/agent-db-sync diff --from sandman --to local
npx @smi0001/agent-db-sync sync --from sandman --to local --dry-run
npx @smi0001/agent-db-sync reconcile --profile local
```

## What it does

| Command      | What                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------- |
| `init`       | Writes a `.dbsync.json` template you can fill in.                                             |
| `profiles`   | Lists configured DB profiles.                                                                 |
| `diff`       | Compares two databases — migrations recorded in `SequelizeMeta` and tables in `public`.       |
| `sync`       | Dumps a source DB and restores into a target. Refuses non-localhost targets unless `--yes`.   |
| `reconcile`  | Interactively inserts pending migration filenames into `SequelizeMeta` — fixes the classic *"column already exists"* situation. |

Built for Postgres. Sequelize is the only assumption made — and only by `reconcile`. `diff` and `sync` work on any pair of Postgres DBs.

## Install

```bash
# On demand
npx @smi0001/agent-db-sync diff

# Or globally
npm i -g @smi0001/agent-db-sync
agent-db-sync --help
```

Requires:

- Node 22+
- `pg_dump` and `psql` on `PATH` (for `sync`). On Debian/Ubuntu: `apt install postgresql-client`.

## Configure

Create a `.dbsync.json` in your project root (or `~/.smi/db-sync.json` for a global default):

```bash
agent-db-sync init
```

```json
{
  "profiles": {
    "sandman": {
      "host": "sandman.example.internal",
      "port": 5432,
      "database": "app",
      "user": "app",
      "password": "${PG_SANDMAN_PASSWORD}"
    },
    "uat":   { "host": "uat.example.internal", "port": 5432, "database": "app", "user": "app", "password": "${PG_UAT_PASSWORD}" },
    "local": { "host": "localhost", "port": 5432, "database": "app_local", "user": "postgres", "password": "${PG_LOCAL_PASSWORD}" }
  },
  "migrations": {
    "dir": "./migrations",
    "metaTable": "SequelizeMeta"
  }
}
```

`${ENV_VAR}` references are expanded from `process.env` at runtime — keep secrets out of the JSON. `dotenv` is loaded automatically, so a sibling `.env` works.

**Path resolution:** `migrations.dir` is resolved relative to the config file's location, not your shell's `cwd`. So you can drop `.dbsync.json` into your project root with `"dir": "./migrations"` and run `agent-db-sync` from anywhere — it always finds the right folder.

**Where to put the config:** if you have one project, the easiest is to keep `.dbsync.json` in that project's repo (gitignored — it has connection info). For tools like this one that aren't in your app repo, point at the app's migrations dir with an absolute path, or use the global location at `~/.smi/db-sync.json`.

## Commands in detail

### `agent-db-sync diff`

Read-only. Compares two profiles:

- migrations recorded in `SequelizeMeta` (or the configured `metaTable`)
- tables in the `public` schema

Flags: `--from <profile>` (default `sandman`), `--to <profile>` (default `local`), `--meta <name>`.

**Tunneled hosts:** if your `host` is `127.0.0.1:5433` because you have an SSH tunnel open (`ssh -L 5433:remote-db:5432 ...`), `diff` and `sync` work transparently — `pg` and `pg_dump` don't care it's a tunnel.

### `agent-db-sync sync`

Pipes `pg_dump` from `--from` into `psql` on `--to`, with `--clean --if-exists --no-owner --no-acl` so you get a clean restore. Always shows a diff and asks to confirm. **Refuses to write into a non-`localhost` target unless you pass `--yes`** — saves you from accidentally clobbering UAT.

After sync, your local mirrors the source — including its `SequelizeMeta`. If your local repo has migrations beyond what the source had, run them with your usual `npx sequelize-cli db:migrate`. If that fails with *"already exists"*, run `reconcile`.

Flags: `--from`, `--to`, `--dry-run`, `--yes`, `--meta`.

### `agent-db-sync reconcile`

The fix for the classic situation: a migration was applied to the DB by some other route (manual SQL, a snapshot restore, a partially-failed previous run), but its filename was never inserted into `SequelizeMeta`. Now `db:migrate` keeps trying to re-apply it and crashes on *"column already exists"*.

`reconcile` lists **pending** migrations (files present in the dir but not recorded in the meta table) and lets you multi-select which to mark as applied. It will not run migrations or change schema — it only inserts rows into the meta table inside a single transaction.

Targets the **local** DB by default — that's the one you'd actually be patching. Reconciling against a remote profile is supported but rarely useful.

If `migrations.dir` isn't configured or the path doesn't exist, you'll get an interactive prompt asking for the path, plus a snippet to paste into `.dbsync.json` so you don't get asked again.

**Pending vs. orphans.** `reconcile` distinguishes two cases and only touches the first:

| Situation                            | Meaning                                            | What `reconcile` does                                |
| ------------------------------------ | -------------------------------------------------- | ---------------------------------------------------- |
| File present, no meta row (`pending`) | Migration ran but wasn't recorded                  | Offers it in the multiselect to mark as applied      |
| Meta row, no file (`orphan`)         | History relic — file was deleted from the repo, or you haven't pulled the branch that has it | Reported only, never modified — needs a human call   |

If your orphan list looks suspiciously long after a sync, that's almost always "I haven't pulled the latest migrations into my checkout yet" — `git pull` in your app repo and the count drops.

Flags: `--profile <name>` (default `local`), `--dir <path>`, `--meta <name>`.

## Typical workflow

```bash
# 1. See what's different between sandman and local
agent-db-sync diff --from sandman --to local

# 2. (optional) preview the destructive sync
agent-db-sync sync --from sandman --to local --dry-run

# 3. do it for real — confirms before writing
agent-db-sync sync --from sandman --to local

# 4. apply any local-only migrations using your existing tooling
cd /path/to/your/app && npx sequelize-cli db:migrate

# 5. if step 4 fails with "already exists":
agent-db-sync reconcile --profile local
# pick the failing migration in the multiselect, retry step 4
```

## Safety notes

- `sync` is destructive on the target. The `--yes` gate for non-`localhost` exists for a reason.
- `reconcile` only ever writes to the meta table — never to schema or data.
- All connections close on completion or error; `reconcile`'s inserts run in a single transaction.

## Roadmap

- LLM-assisted recovery for unknown migration errors (currently only Postgres "already exists" / "already reverted" codes are auto-classified)
- MySQL support
- Schema-level diff (columns, indexes, constraints) beyond just table names
- SSH tunnel option in profile config

## License

MIT © Shammi Hans
