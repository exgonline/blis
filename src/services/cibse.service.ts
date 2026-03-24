import { pool } from '../db/client';
import type { CibseBenchmarkRow, AgeMultiplierRow } from '../types/index';

export class CibseService {
  async getBenchmark(category: string): Promise<CibseBenchmarkRow> {
    const result = await pool.query<CibseBenchmarkRow>(
      'SELECT * FROM cibse_benchmarks WHERE category = $1 LIMIT 1',
      [category],
    );

    if (result.rows.length === 0) {
      // Fall back to 'unknown'
      const fallback = await pool.query<CibseBenchmarkRow>(
        "SELECT * FROM cibse_benchmarks WHERE category = 'unknown' LIMIT 1",
      );
      if (fallback.rows.length === 0) {
        throw new Error(`CIBSE benchmark not found for category: ${category}`);
      }
      return fallback.rows[0]!;
    }

    return result.rows[0]!;
  }

  async getAllBenchmarks(): Promise<CibseBenchmarkRow[]> {
    const result = await pool.query<CibseBenchmarkRow>(
      'SELECT * FROM cibse_benchmarks ORDER BY category ASC',
    );
    return result.rows;
  }

  async getAgeMultiplier(ageBand: string): Promise<number> {
    const result = await pool.query<AgeMultiplierRow>(
      'SELECT * FROM age_multipliers WHERE age_band = $1 LIMIT 1',
      [ageBand],
    );

    if (result.rows.length === 0) {
      // Fall back to 'unknown'
      const fallback = await pool.query<AgeMultiplierRow>(
        "SELECT * FROM age_multipliers WHERE age_band = 'unknown' LIMIT 1",
      );
      if (fallback.rows.length === 0) {
        throw new Error(`Age multiplier not found for band: ${ageBand}`);
      }
      return parseFloat(fallback.rows[0]!.multiplier);
    }

    return parseFloat(result.rows[0]!.multiplier);
  }
}

export const cibseService = new CibseService();
