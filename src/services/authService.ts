import bcrypt from 'bcryptjs';
import { supabaseAdmin } from './supabase.js';

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  active: boolean;
  tenant_id: string | null;
  tenants: { name: string; slug: string } | null;
}

export async function loginUser(email: string, password: string) {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, name, email, password_hash, role, active, tenant_id, tenants(name, slug)')
    .eq('email', email.toLowerCase().trim())
    .limit(1)
    .maybeSingle() as { data: UserRow | null; error: unknown };

  if (error) {
    console.error('[auth] loginUser error:', error);
    return { success: false, error: 'Erro ao acessar o banco de dados.' };
  }

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
      tenantId:   user.tenant_id              || null,
      tenantName: user.tenants?.name          || 'Default',
      tenantSlug: user.tenants?.slug          || 'default',
    },
  };
}

export async function registerUser(
  name: string,
  email: string,
  password: string,
  role: string,
  tenantId?: string,
) {
  const normalizedEmail = email.toLowerCase().trim();

  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', normalizedEmail)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return { success: false, error: 'Já existe uma conta com este e-mail.' };
  }

  let resolvedTenantId = tenantId || null;
  if (!resolvedTenantId) {
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('slug', 'default')
      .limit(1)
      .maybeSingle();
    resolvedTenantId = tenant?.id || null;
  }

  const password_hash = await bcrypt.hash(password, 10);

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .insert({
      name:          name.trim(),
      email:         normalizedEmail,
      password_hash,
      role,
      active:        true,
      tenant_id:     resolvedTenantId,
      max_instances: 3,
    })
    .select('id, name, email, role, tenant_id')
    .single();

  if (error) {
    console.error('[auth] registerUser error:', error);
    return { success: false, error: 'Erro ao criar usuário.' };
  }

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
}

export async function requestPasswordReset(
  email: string,
  _redirectTo: string,
): Promise<{ success: boolean; error?: string }> {
  const normalizedEmail = email.toLowerCase().trim();

  const { data } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', normalizedEmail)
    .limit(1)
    .maybeSingle();

  if (!data) {
    console.log(`[auth] requestPasswordReset: e-mail não encontrado — resposta genérica`);
    return { success: true };
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
