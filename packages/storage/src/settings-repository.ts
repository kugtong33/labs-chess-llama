import { SettingsSchema, type Settings } from '@chess-llama/contracts';

import type { SqliteDatabase } from './database.js';

export interface SettingsRepository {
  get(): Settings;
  update(patch: Partial<Settings>): Settings;
}

interface SettingsRow {
  preferred_human_color: string;
  board_orientation: string;
  theme: string;
  commentary_style: string;
  model_profile_id: string;
  stockfish_candidate_limit: number;
  stockfish_move_time_ms: number;
}

export function createSettingsRepository(
  db: SqliteDatabase,
): SettingsRepository {
  const read = (): Settings => {
    const row = db.prepare('SELECT * FROM settings WHERE id = 1').get() as
      SettingsRow | undefined;
    if (row === undefined) throw new Error('Settings row is missing');
    return SettingsSchema.parse({
      preferredHumanColor: row.preferred_human_color,
      boardOrientation: row.board_orientation,
      theme: row.theme,
      commentaryStyle: row.commentary_style,
      modelProfileId: row.model_profile_id,
      stockfishCandidateLimit: row.stockfish_candidate_limit,
      stockfishMoveTimeMs: row.stockfish_move_time_ms,
    });
  };

  return {
    get: read,
    update(patch) {
      const next = SettingsSchema.parse({ ...read(), ...patch });
      db.prepare(
        `UPDATE settings
         SET preferred_human_color = ?, board_orientation = ?, theme = ?,
             commentary_style = ?, model_profile_id = ?,
             stockfish_candidate_limit = ?, stockfish_move_time_ms = ?,
             updated_at = ?
         WHERE id = 1`,
      ).run(
        next.preferredHumanColor,
        next.boardOrientation,
        next.theme,
        next.commentaryStyle,
        next.modelProfileId,
        next.stockfishCandidateLimit,
        next.stockfishMoveTimeMs,
        Date.now(),
      );
      return read();
    },
  };
}
