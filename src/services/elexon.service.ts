import { pool } from '../db/client';
import { logger } from '../utils/logger';
import type { ElexonProfileRow } from '../types/index';

export class ElexonService {
  async getCoefficient(
    profileClass: number,
    season: string,
    dayType: string,
    periodIndex: number,
  ): Promise<ElexonProfileRow> {
    const result = await pool.query<ElexonProfileRow>(
      `SELECT * FROM elexon_profiles
       WHERE profile_class = $1
         AND season = $2
         AND day_type = $3
         AND period_index = $4
       LIMIT 1`,
      [profileClass, season, dayType, periodIndex],
    );

    if (result.rows.length === 0) {
      throw new Error(
        `Elexon coefficient not found: PC${profileClass}, ${season}, ${dayType}, period ${periodIndex}`,
      );
    }

    return result.rows[0]!;
  }

  async getProfile(
    profileClass: number,
    season: string,
    dayType: string,
  ): Promise<ElexonProfileRow[]> {
    const result = await pool.query<ElexonProfileRow>(
      `SELECT * FROM elexon_profiles
       WHERE profile_class = $1
         AND season = $2
         AND day_type = $3
       ORDER BY period_index ASC`,
      [profileClass, season, dayType],
    );

    if (result.rows.length === 0) {
      logger.warn(`No Elexon profile found for PC${profileClass}, ${season}, ${dayType}`);
    }

    return result.rows;
  }
}

export const elexonService = new ElexonService();
