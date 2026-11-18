// SQLite database for assessments, plans, step discussions and files.
// One file on disk: backend/data/l6s.db (created on first start, git-ignored).
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
export const DB_PATH = process.env.L6S_DB_PATH || path.join(DATA_DIR, 'l6s.db');
export const UPLOAD_DIR = process.env.L6S_UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS assessments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  scores      TEXT    NOT NULL,          -- {"IL1":3,...,"IM7":2}
  prediction  REAL,                      -- predicted performance % from the engine
  strategy    TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plans (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  assessment_id   INTEGER REFERENCES assessments(id),
  title           TEXT    NOT NULL,
  depth           INTEGER NOT NULL,      -- stages per workstream (levels to gain per factor)
  start_scores    TEXT    NOT NULL,      -- levels at the start
  current_scores  TEXT    NOT NULL,      -- levels now (go up when a stage is validated)
  start_prediction REAL,
  current_prediction REAL,
  status          TEXT    NOT NULL DEFAULT 'active',   -- active | archived | completed
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plan_stages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id       INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  workstream    TEXT    NOT NULL,
  stage_no      INTEGER NOT NULL,
  name_en       TEXT    NOT NULL,
  name_fr       TEXT    NOT NULL,
  weeks         INTEGER NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'open',      -- open | validated
  validated_at  TEXT,
  UNIQUE (plan_id, workstream, stage_no)
);

CREATE TABLE IF NOT EXISTS plan_steps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id       INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  stage_id      INTEGER NOT NULL REFERENCES plan_stages(id) ON DELETE CASCADE,
  catalog_id    TEXT    NOT NULL,      -- e.g. IL4-3 = factor IL4, level 3
  factor        TEXT    NOT NULL,
  from_level    INTEGER NOT NULL,
  to_level      INTEGER NOT NULL,
  checklist     TEXT    NOT NULL,      -- [true,false,...] one per detailed step
  status        TEXT    NOT NULL DEFAULT 'todo',      -- todo | in_progress | done
  owner         TEXT    DEFAULT '',
  due_date      TEXT,
  kpi_target    TEXT    DEFAULT '',
  done_at       TEXT,
  position      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS step_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  step_id     INTEGER NOT NULL REFERENCES plan_steps(id) ON DELETE CASCADE,
  user_id     INTEGER,
  kind        TEXT    NOT NULL DEFAULT 'update',      -- update | system
  text        TEXT    NOT NULL,
  file_id     INTEGER,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  plan_id       INTEGER REFERENCES plans(id) ON DELETE CASCADE,
  step_id       INTEGER REFERENCES plan_steps(id) ON DELETE SET NULL,
  original_name TEXT    NOT NULL,
  stored_name   TEXT    NOT NULL,
  mime          TEXT,
  size          INTEGER,
  kind          TEXT,                  -- csv | excel | pdf | image | doc | other
  summary       TEXT,                  -- JSON: what was read from the file
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plan_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id     INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  type        TEXT    NOT NULL,        -- created | step_done | step_reopened | stage_validated | unlocked | file | update | edit
  text_en     TEXT    NOT NULL,
  text_fr     TEXT    NOT NULL,
  data        TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kpi_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  step_id     INTEGER NOT NULL REFERENCES plan_steps(id) ON DELETE CASCADE,
  kpi_index   INTEGER NOT NULL,      -- which KPI of the catalog action
  num         REAL,                  -- ratio KPIs: numerator typed by the user
  den         REAL,                  -- ratio KPIs: denominator typed by the user
  value       REAL    NOT NULL,      -- result calculated by the app
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kpi_step ON kpi_entries(step_id);
CREATE INDEX IF NOT EXISTS idx_plans_user ON plans(user_id, status);
CREATE INDEX IF NOT EXISTS idx_steps_plan ON plan_steps(plan_id);
CREATE INDEX IF NOT EXISTS idx_msgs_step ON step_messages(step_id);
CREATE INDEX IF NOT EXISTS idx_files_plan ON files(plan_id);
CREATE INDEX IF NOT EXISTS idx_events_plan ON plan_events(plan_id);
`);

// Columns added after the first version: add them to an existing database
const addColumn = (table, column, type) => {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
};
addColumn('plans', 'target_pct', 'REAL');            // target performance (from real companies)
addColumn('plans', 'target_levels', 'TEXT');         // {"IL1":5,...} levels of the companies at that target
addColumn('plans', 'target_basis', 'TEXT');          // {"key":"q1","n":101,"avgPerf":70.2}
addColumn('plans', 'target_prediction', 'REAL');     // model prediction with the target levels
addColumn('plan_steps', 'kpi_targets', "TEXT DEFAULT '{}'"); // {"0":{"target":80,"direction":"up"}}

export default db;
