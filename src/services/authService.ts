import bcrypt from 'bcryptjs';
import { pool } from './supabase.js';

export async function loginUser(email: string, password: string) {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query<{
      id: string; name: string; email: string; password_hash: string;
      role: string; active: boolean; tenant_id: string | null;
      tenant_name: string | null; tenant_slug: string | null;
    }>(
      `SELECT u.id, u.name, u.email, u.password_hash, u.role, u.active, u.tenant_id,
              t.name AS tenant_name, t.slug AS tenant_slug
       FROM "users" u
       LEFT JOIN "tenants" t ON t.id = u.tenant_id
       WHERE u.email = $1
       LIMIT 1`,
      [email.toLowerCase().trim()],
    );

    const user = result.rows[0] ?? null;

    if (!user) {
      return { success: false, error: 'E-mail ou senha incorretos.' };
    }

    if (!user.active) {
      return { success: false, error: 'Conta desativada. Fale com o administrador.' };
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return { success: false, error: 'E-mail ou senha incorretos.' };
    }

    return {
      success: true,
      user: {
        id:         user.id,
        name:       user.name,
        email:      user.email,
        role:       user.role,
        tenantId:   user.tenant_id   || null,
        tenantName: user.tenant_name || 'Default',
        tenantSlug: user.tenant_slug || 'default',
      },
    };
  } catch (err: unknown) {
    console.error('[auth] loginUser error:', err);
    return { success: false, error: 'Erro ao acessar o banco de dados.' };
  } finally {
    client?.release();
  }
}

export async function registerUser(
  name: string,
  email: string,
  password: string,
  role: string,
  tenantId?: string,
) {
  const normalizedEmail = email.toLowerCase().trim();
  let client;
  try {
    client = await pool.connect();

    const existing = await client.query(
      'SELECT id FROM "users" WHERE email = $1 LIMIT 1',
      [normalizedEmail],
    );

    if (existing.rows.length > 0) {
      return { success: false, error: 'Já existe uma conta com este e-mail.' };
    }

    let resolvedTenantId = tenantId || null;
    if (!resolvedTenantId) {
      const tenant = await client.query(
        'SELECT id FROM "tenants" WHERE slug = $1 LIMIT 1',
        ['default'],
      );
      resolvedTenantId = tenant.rows[0]?.id || null;
    }

    const password_hash = await bcrypt.hash(password, 10);

    const insert = await client.query<{ id: string; name: string; email: string; role: string; tenant_id: string | null }>(
      `INSERT INTO "users" (name, email, password_hash, role, active, tenant_id, max_instances)
       VALUES ($1, $2, $3, $4, true, $5, 3)
       RETURNING id, name, email, role, tenant_id`,
      [name.trim(), normalizedEmail, password_hash, role, resolvedTenantId],
    );

    const user = insert.rows[0];

    return {
      success: true,
      user: {
        id:       user.id,
        name:     user.name,
        email:    user.email,
        role:     user.role,
        tenantId: user.tenant_id || null,
      },
    };
  } catch (err: unknown) {
    console.error('[auth] registerUser error:', err);
    return { success: false, error: 'Erro ao criar usuário.' };
  } finally {
    client?.release();
  }
}

export async function requestPasswordReset(
  email: string,
  _redirectTo: string,
): Promise<{ success: boolean; error?: string }> {
  const normalizedEmail = email.toLowerCase().trim();
  let client;
  try {
    client = await pool.connect();
    const result = await client.query('SELECT id FROM "users" WHERE email = $1 LIMIT 1', [normalizedEmail]);
    if (!result.rows[0]) {
      console.log(`[auth] requestPasswordReset: e-mail não encontrado — resposta genérica`);
    } else {
      console.warn('[auth] requestPasswordReset: funcionalidade de e-mail não configurada neste ambiente.');
    }
  } catch (err) {
    console.error('[auth] requestPasswordReset error:', err);
  } finally {
    client?.release();
  }
  return { success: true };
}

export async function resetPassword(
  _accessToken: string,
  _newPassword: string,
): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: 'Redefinição de senha por token não está disponível. Contate o administrador.' };
}
