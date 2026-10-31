import Database from "better-sqlite3";

export type RelayDatabase = Database.Database;

const MIGRATION_1 = `
CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL
);

CREATE TABLE quests (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL,
  current_channel_id TEXT NOT NULL,
  source_channel_id TEXT,
  target_channel_id TEXT,
  party_size INTEGER CHECK (party_size IS NULL OR party_size >= 0),
  party_tier TEXT CHECK (party_tier IS NULL OR party_tier IN ('small', 'medium', 'large')),
  canon_name TEXT,
  pending_name TEXT,
  beat1_flag TEXT CHECK (beat1_flag IS NULL OR beat1_flag IN ('bond', 'power')),
  deadline_at INTEGER,
  paused_at INTEGER,
  last_vote_resolution_json TEXT,
  outcome_json TEXT,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE quest_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quest_id TEXT NOT NULL REFERENCES quests(id),
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE (quest_id, sequence)
);

CREATE TABLE votes (
  quest_id TEXT NOT NULL REFERENCES quests(id),
  round INTEGER NOT NULL CHECK (round IN (1, 2)),
  voter_hash TEXT NOT NULL,
  faction TEXT NOT NULL CHECK (faction IN ('raider', 'local')),
  choice TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (quest_id, round, voter_hash)
);

CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

export function openDatabase(path: string): RelayDatabase {
  const database = new Database(path);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  applyMigrations(database);
  return database;
}

export function applyMigrations(database: RelayDatabase): void {
  database.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  const version = (
    database
      .prepare(
        "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
      )
      .get() as { version: number }
  ).version;
  if (version < 1) {
    const migrate = database.transaction(() => {
      database.exec(MIGRATION_1);
      database
        .prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)",
        )
        .run(Date.now());
    });
    migrate();
  }
}
