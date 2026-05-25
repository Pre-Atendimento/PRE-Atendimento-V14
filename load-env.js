/**
 * load-env.js
 * Este arquivo deve ser o PRIMEIRO import em server.ts.
 * Define DATABASE_URL a partir de SUPABASE_DB_URL (Supabase Pooler).
 */
if (process.env.SUPABASE_DB_URL) {
  process.env.DATABASE_URL = process.env.SUPABASE_DB_URL;
}
