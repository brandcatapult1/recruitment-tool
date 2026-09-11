import { Pool, types } from 'pg';
import { config } from '../config';

// DATE columns as YYYY-MM-DD strings. The default Date parser shifts the
// calendar day in timezones ahead of UTC (opened_date of 2026-09-11 becoming
// 2026-09-10 in IST).
types.setTypeParser(types.builtins.DATE, (value) => value);

/**
 * Single pooled connection to Neon (PRD §13.3: pooled connection string via
 * DATABASE_URL). All queries in the app go through this pool.
 */
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
});
