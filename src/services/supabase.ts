/**
 * Database access layer using direct pg pool.
 * Replaces @supabase/supabase-js with native PostgreSQL queries.
 */
import pool from '../db/pool.js';

export { pool as db };

// Stub out auth methods — custom JWT auth is used instead
export const supabaseAdmin = {
  auth: {
    resetPasswordForEmail: async (_email: string, _opts?: { redirectTo?: string }) => {
      console.warn('[auth] resetPasswordForEmail: Supabase auth removed. Use a custom email flow.');
      return { error: { message: 'Redefinição de senha por e-mail não está disponível neste ambiente. Contate o administrador.' } };
    },
    getUser: async (_token: string) => {
      return { data: { user: null }, error: { message: 'Supabase auth não disponível.' } };
    },
    admin: {
      createUser: async (_opts: unknown) => {
        return { error: { message: 'Supabase auth não disponível.' } };
      },
    },
  },
};

export const supabaseUrl = '';
export const supabaseClient = supabaseAdmin;
