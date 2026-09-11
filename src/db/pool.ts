import { Pool } from 'pg';
import { config } from '../config';

/**
 * Single pooled connection to Neon (PRD §13.3: pooled connection string via
 * DATABASE_URL). All queries in the app go through this pool.
 */
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
});
