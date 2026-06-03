/**
 * load-env.js
 * Replit provides DATABASE_URL directly. This file handles backwards compat
 * for SUPABASE_DB_URL if someone still has it set.
 */
if (!process.env.DATABASE_URL && process.env.SUPABASE_DB_URL) {
  process.env.DATABASE_URL = process.env.SUPABASE_DB_URL;
}
