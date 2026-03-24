import path from 'path';
import { pool } from '../db/client';
import { logger } from '../utils/logger';
import { periodIndexToHhmm } from '../utils/season';
import type { ElexonProfileData, ElexonSeasonData, ElexonDayTypeData } from '../types/index';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const profileData: ElexonProfileData = require(
  path.resolve(process.cwd(), 'src/data/elexon-profiles.json'),
) as ElexonProfileData;

const SEASONS = ['winter', 'spring', 'summer', 'high_summer', 'autumn'] as const;
const DAY_TYPES = ['weekday', 'saturday', 'sunday'] as const;

type Season = (typeof SEASONS)[number];
type DayTypeKey = (typeof DAY_TYPES)[number];

export async function loadElexonProfiles(): Promise<void> {
  logger.info('Loading Elexon profiles into database…');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let inserted = 0;
    let skipped = 0;

    for (const [profileClassStr, seasonData] of Object.entries(profileData.profiles)) {
      const profileClass = parseInt(profileClassStr, 10);
      const typedSeasonData = seasonData as ElexonSeasonData;

      for (const season of SEASONS) {
        const dayData = typedSeasonData[season];
        if (!dayData) continue;

        const typedDayData = dayData as ElexonDayTypeData;

        for (const dayType of DAY_TYPES) {
          const coefficients = typedDayData[dayType];
          if (!coefficients || !Array.isArray(coefficients)) continue;

          for (let periodIndex = 0; periodIndex < coefficients.length; periodIndex++) {
            const coefficient = coefficients[periodIndex];
            if (coefficient === undefined) continue;

            const periodStartHhmm = periodIndexToHhmm(periodIndex);

            const result = await client.query(
              `INSERT INTO elexon_profiles
                (profile_class, season, day_type, period_index, period_start_hhmm, coefficient, data_version)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (profile_class, season, day_type, period_index) DO NOTHING`,
              [
                profileClass,
                season,
                dayType,
                periodIndex,
                periodStartHhmm,
                coefficient,
                profileData.version,
              ],
            );

            if (result.rowCount && result.rowCount > 0) {
              inserted++;
            } else {
              skipped++;
            }
          }
        }
      }
    }

    await client.query('COMMIT');
    logger.info(`Elexon profiles loaded: ${inserted} inserted, ${skipped} already present.`);
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Failed to load Elexon profiles', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    client.release();
  }
}
