import pg from 'pg';
import bcrypt from 'bcryptjs';

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  active: boolean;
  tenant_id: string | null;
  tenant_name: string | null;
  tenant_slug: string | null;
}

function getClient() {
  return new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  });
}

export async function loginUser(email: string, password: string) {
  const client = getClient();
  try {
    await client.connect();
    const { rows } = await client.query<UserRow>(
      `SELECT u.id, u.name, u.email, u.password_hash, u.role, u.active,
              u.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug
       FROM public.users u
       LEFT JOIN public.tenants t ON t.id = u.tenant_id
       WHERE u.email = $1
       LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    if (!rows.length) {
      return { success: false, error: 'E-mail ou senha incorretos.' };
    }

    const user = rows[0];

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
  } finally {
    await client.end();
  }
}

export async function registerUser(
  name: string,
  email: string,
  password: string,
  role: string,
  tenantId?: string,
) {
  const client = getClient();
  try {
    await client.connect();

    const { rows: existing } = await client.query(
      'SELECT id FROM public.users WHERE email = $1 LIMIT 1',
      [email.toLowerCase().trim()]
    );

    if (existing.length) {
      return { success: false, error: 'Já existe uma conta com este e-mail.' };
    }

    let resolvedTenantId = tenantId || null;
    if (!resolvedTenantId) {
      const { rows: tenantRows } = await client.query<{ id: string }>(
        `SELECT id FROM public.tenants WHERE slug = 'default' LIMIT 1`
      );
      resolvedTenantId = tenantRows[0]?.id || null;
    }

    const password_hash = await bcrypt.hash(password, 10);

    const { rows } = await client.query<{ id: string; name: string; email: string; role: string; tenant_id: string }>(
      `INSERT INTO public.users (name, email, password_hash, role, active, tenant_id, max_instances)
       VALUES ($1, $2, $3, $4, true, $5, 3)
       RETURNING id, name, email, role, tenant_id`,
      [name.trim(), email.toLowerCase().trim(), password_hash, role, resolvedTenantId]
    );

    const user = rows[0];
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
  } finally {
    await client.end();
  }
}

export async function requestPasswordReset(
  email: string,
  _redirectTo: string,
): Promise<{ success: boolean; error?: string }> {
  const normalizedEmail = email.toLowerCase().trim();

  const client = getClient();
  try {
    await client.connect();
    const { rows } = await client.query(
      'SELECT id FROM public.users WHERE email = $1 LIMIT 1',
      [normalizedEmail],
    );
    if (!rows.length) {
      console.log(`[auth] requestPasswordReset: e-mail não encontrado — resposta genérica`);
      return { success: true };
    }
  } finally {
    await client.end();
  }

  console.warn('[auth] requestPasswordReset: funcionalidade de e-mail não configurada neste ambiente.');
  return { success: true };
}

export async function resetPassword(
  _accessToken: string,
  _newPassword: string,
): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: 'Redefinição de senha por token não está disponível. Contate o administrador.' };
}
