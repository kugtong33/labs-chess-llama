PRAGMA foreign_keys = ON;

CREATE TABLE games (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'awaiting_ai', 'completed')),
  human_color TEXT NOT NULL CHECK (human_color IN ('white', 'black')),
  current_fen TEXT NOT NULL,
  pgn TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT '*' CHECK (result IN ('1-0', '0-1', '1/2-1/2', '*')),
  model_profile_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
) STRICT;

CREATE TABLE moves (
  id TEXT PRIMARY KEY NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply INTEGER NOT NULL CHECK (ply > 0),
  color TEXT NOT NULL CHECK (color IN ('white', 'black')),
  actor TEXT NOT NULL CHECK (actor IN ('human', 'llm')),
  uci TEXT NOT NULL,
  san TEXT NOT NULL,
  fen_after TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (game_id, ply)
) STRICT;

CREATE TABLE ai_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  move_id TEXT NOT NULL UNIQUE REFERENCES moves(id) ON DELETE CASCADE,
  candidates_json TEXT NOT NULL CHECK (json_valid(candidates_json)),
  chosen_uci TEXT NOT NULL,
  commentary TEXT NOT NULL CHECK (length(commentary) <= 240),
  model_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  quantization TEXT NOT NULL,
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  tokens_per_second REAL,
  retry_count INTEGER NOT NULL CHECK (retry_count IN (0, 1)),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE settings (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  preferred_human_color TEXT NOT NULL CHECK (preferred_human_color IN ('white', 'black')),
  board_orientation TEXT NOT NULL CHECK (board_orientation IN ('white', 'black')),
  theme TEXT NOT NULL CHECK (theme IN ('system', 'light', 'dark')),
  commentary_style TEXT NOT NULL CHECK (commentary_style IN ('concise', 'coach', 'playful')),
  model_profile_id TEXT NOT NULL,
  stockfish_candidate_limit INTEGER NOT NULL CHECK (stockfish_candidate_limit BETWEEN 1 AND 5),
  stockfish_move_time_ms INTEGER NOT NULL CHECK (stockfish_move_time_ms BETWEEN 25 AND 1000),
  updated_at INTEGER NOT NULL
) STRICT;

INSERT INTO settings VALUES (1, 'white', 'white', 'system', 'concise', 'qwen3-4b-q4-k-m', 5, 100, unixepoch() * 1000);
