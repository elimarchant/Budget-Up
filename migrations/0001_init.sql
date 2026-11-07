-- Budget Up schema. All money is stored as integer agorot (1 NIS = 100 agorot).

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  email         TEXT,
  email_summary INTEGER NOT NULL DEFAULT 1,
  pw_hash       TEXT NOT NULL,
  pw_salt       TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE login_attempts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  ip       TEXT,
  at       INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts ON login_attempts(username, at);

-- A "ledger" is one shared budget (e.g. "Eli's family", "Parents").
CREATE TABLE ledgers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  owner_id   TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE members (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (ledger_id, user_id)
);
CREATE INDEX idx_members_user ON members(user_id);

CREATE TABLE invites (
  token      TEXT PRIMARY KEY,
  ledger_id  TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Categories form a two-level tree: parent_id NULL = main category.
CREATE TABLE categories (
  id        TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  parent_id TEXT REFERENCES categories(id),
  sort      INTEGER NOT NULL DEFAULT 0,
  archived  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_categories_ledger ON categories(ledger_id);

CREATE TABLE transactions (
  id          TEXT PRIMARY KEY,
  ledger_id   TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('income','expense')),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  category_id TEXT REFERENCES categories(id),
  comment     TEXT NOT NULL DEFAULT '',
  date        TEXT NOT NULL,            -- YYYY-MM-DD
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL,
  default_id  TEXT
);
CREATE INDEX idx_tx_ledger_date ON transactions(ledger_id, date);

-- Recurring "default" income / expenses, added automatically on the 1st of every month.
CREATE TABLE defaults (
  id          TEXT PRIMARY KEY,
  ledger_id   TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('income','expense')),
  category_id TEXT REFERENCES categories(id),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  comment     TEXT NOT NULL DEFAULT '',
  start_month TEXT NOT NULL,            -- YYYY-MM
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_defaults_ledger ON defaults(ledger_id);

CREATE TABLE defaults_applied (
  default_id TEXT NOT NULL,
  month      TEXT NOT NULL,
  PRIMARY KEY (default_id, month)
);

-- Maaser (charity) payments.
CREATE TABLE maaser_gives (
  id         TEXT PRIMARY KEY,
  ledger_id  TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL CHECK (amount > 0),
  date       TEXT NOT NULL,
  comment    TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_maaser_ledger ON maaser_gives(ledger_id, date);

-- Prevents the monthly summary email being sent twice.
CREATE TABLE summary_log (
  user_id TEXT NOT NULL,
  month   TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (user_id, month)
);
