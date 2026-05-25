/**
 * load-env.js
 * Ensures DATABASE_URL is available for pg connections.
 * DATABASE_URL is automatically provided by Replit's PostgreSQL integration.
 */
if (!process.env.DATABASE_URL && process.env.SUPABASE_DB_URL) {
  process.env.DATABASE_URL = process.env.SUPABASE_DB_URL;
}
