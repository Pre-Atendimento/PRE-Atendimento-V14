import { supabaseAdmin } from './supabase.js';
import {
  createInstance    as callCreate,
  connectInstance   as callConnect,
  disconnectInstance as callDisconnect,
  logoutInstance    as callLogout,
  deleteInstance    as callDelete,
} from './evolutionGo.js';

function extractInstanceToken(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const d = data as Record<string, unknown>;

  const inner = d.data as Record<string, unknown> | undefined;
  if (inner?.token)  return String(inner.token);
  if (inner?.apikey) return String(inner.apikey);

  const hash = d.hash as Record<string, unknown> | undefined;
  if (hash?.token)  return String(hash.token);
  if (hash?.apikey) return String(hash.apikey);

  if (d.token)  return String(d.token);
  if (d.apikey) return String(d.apikey);

  return '';
}

async function getInstanceMeta(
  instanceName: string,
  tenantId?: string,
  isAdmin = false,
  userId?: string,
): Promise<{ uuid: string; token: string; found: boolean }> {
  let q = supabaseAdmin
    .from('instances')
    .select('metadata')
    .eq('instance_name', instanceName);

  if (!isAdmin) {
    if (tenantId) q = q.eq('tenant_id', tenantId);
    if (userId)   q = q.eq('created_by', userId);
  }

  const { data: inst } = await q.maybeSingle();

  if (!inst) return { uuid: '', token: '', found: false };

  const meta = inst.metadata as Record<string, unknown> | null;
  if (!meta) return { uuid: '', token: '', found: true };

  const newData = (meta.create as Record<string, unknown> | undefined)
    ?.data as Record<string, unknown> | undefined;
  const oldData = meta.data as Record<string, unknown> | undefined;

  const uuid =
    (newData?.id  as string | undefined) ||
    (oldData?.id  as string | undefined) || '';

  const token =
    (meta.token   as string | undefined) ||
    (newData?.token as string | undefined) ||
    (oldData?.token as string | undefined) || '';

  if (uuid || token) return { uuid, token, found: true };
  return { uuid: '', token: '', found: true };
}

export async function createInstanceAndPersist(
  instanceName: string,
  tenantId:     string,
  createdBy:    string,
  token?:       string,
  overrideUrl?: string,
  overrideKey?: string,
) {
  const { data: existing } = await supabaseAdmin
    .from('instances')
    .select('id, instance_name, status')
    .eq('instance_name', instanceName)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (existing) {
    return {
      success: false,
      error: `Instância "${instanceName}" já existe com status "${(existing as Record<string, unknown>).status}".`,
    };
  }

  console.log('[instanceService] ▶ Passo 1/2: criar instância na API');
  const createResult = await callCreate(instanceName, token, overrideUrl, overrideKey);

  if (!createResult.success) {
    console.error(`[instanceService] ✖ API recusou criar "${instanceName}": ${createResult.error}`);
    return {
      success:    false,
      error:      createResult.error || 'A API rejeitou a criação da instância.',
      httpStatus: createResult.httpStatus,
    };
  }

  let connectResult = null;
  const instanceToken = extractInstanceToken(createResult.data);

  if (instanceToken) {
    console.log('[instanceService] ▶ Passo 2/2: conectar instância');
    connectResult = await callConnect(instanceToken, overrideUrl);
  } else {
    console.warn('[instanceService] ⚠️  Token não encontrado — pulando connect');
  }

  const metadata = {
    create:  createResult.data  ?? null,
    connect: connectResult?.data ?? null,
    token:   instanceToken       || null,
  };

  const { data: record } = await supabaseAdmin
    .from('instances')
    .insert({
      instance_name: instanceName,
      status:        'active',
      provider:      'evo-go',
      tenant_id:     tenantId,
      created_by:    createdBy,
      metadata,
    })
    .select()
    .single();

  if (!record) {
    return {
      success: true,
      data: {
        instance_name:    instanceName,
        status:           'active',
        tenant_id:        tenantId,
        instance_token:   instanceToken || null,
        create_response:  createResult.data,
        connect_response: connectResult?.data ?? null,
      },
      warning: 'Instância criada na API mas não foi possível salvar localmente.',
    };
  }

  await supabaseAdmin.from('instance_logs').insert({
    instance_id: (record as Record<string, unknown>).id,
    event:       'created',
    payload:     {
      create:  createResult.data,
      connect: connectResult ? { success: connectResult.success, data: connectResult.data } : null,
    },
  });

  return {
    success: true,
    data: {
      ...(record as Record<string, unknown>),
      status:           'active',
      instance_token:   instanceToken || null,
      create_response:  createResult.data,
      connect_response: connectResult?.data ?? null,
    },
  };
}

export async function listInstances(tenantId?: string, isAdmin = false, userId?: string) {
  try {
    let q = supabaseAdmin
      .from('instances')
      .select('id, instance_name, status, provider, created_at, updated_at, metadata, tenant_id, created_by')
      .order('created_at', { ascending: false });

    if (!isAdmin) {
      if (tenantId) q = q.eq('tenant_id', tenantId);
      if (userId)   q = q.eq('created_by', userId);
    }

    const { data, error } = await q;
    if (error) throw error;
    return { success: true, data: data ?? [] };
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message };
  }
}

export async function disconnectInstanceService(
  instanceName:   string,
  tenantId?:      string,
  isAdmin?:       boolean,
  instanceToken?: string,
  overrideUrl?:   string,
  userId?:        string,
) {
  let token = instanceToken || '';
  if (!token) {
    const meta = await getInstanceMeta(instanceName, tenantId, isAdmin, userId);
    if (!meta.found) return { success: false, error: `Instância "${instanceName}" não encontrada ou sem permissão.` };
    token = meta.token;
  }

  const result = await callDisconnect(token, overrideUrl);

  if (result.success) {
    let upQ = supabaseAdmin.from('instances').update({ status: 'inactive' }).eq('instance_name', instanceName);
    if (!isAdmin) {
      if (tenantId) upQ = upQ.eq('tenant_id', tenantId);
      if (userId)   upQ = upQ.eq('created_by', userId);
    }
    await upQ;

    let logQ = supabaseAdmin.from('instances').select('id').eq('instance_name', instanceName);
    if (!isAdmin) {
      if (tenantId) logQ = logQ.eq('tenant_id', tenantId);
      if (userId)   logQ = logQ.eq('created_by', userId);
    }
    const { data: inst } = await logQ.maybeSingle();
    if (inst && (inst as Record<string, unknown>).id) {
      await supabaseAdmin.from('instance_logs').insert({
        instance_id: (inst as Record<string, unknown>).id,
        event:       'disconnected',
        payload:     result.data ?? {},
      });
    }
  }

  return { success: result.success, data: result.data, error: result.error };
}

export async function logoutInstanceService(
  instanceName:   string,
  tenantId?:      string,
  isAdmin?:       boolean,
  instanceToken?: string,
  overrideUrl?:   string,
  userId?:        string,
) {
  let token = instanceToken || '';
  if (!token) {
    const meta = await getInstanceMeta(instanceName, tenantId, isAdmin, userId);
    if (!meta.found) return { success: false, error: `Instância "${instanceName}" não encontrada ou sem permissão.` };
    token = meta.token;
  }

  const result = await callLogout(token, overrideUrl);

  if (result.success) {
    let upQ = supabaseAdmin.from('instances').update({ status: 'inactive' }).eq('instance_name', instanceName);
    if (!isAdmin) {
      if (tenantId) upQ = upQ.eq('tenant_id', tenantId);
      if (userId)   upQ = upQ.eq('created_by', userId);
    }
    await upQ;

    let logQ = supabaseAdmin.from('instances').select('id').eq('instance_name', instanceName);
    if (!isAdmin) {
      if (tenantId) logQ = logQ.eq('tenant_id', tenantId);
      if (userId)   logQ = logQ.eq('created_by', userId);
    }
    const { data: inst } = await logQ.maybeSingle();
    if (inst && (inst as Record<string, unknown>).id) {
      await supabaseAdmin.from('instance_logs').insert({
        instance_id: (inst as Record<string, unknown>).id,
        event:       'logout',
        payload:     result.data ?? {},
      });
    }
  }

  return { success: result.success, data: result.data, error: result.error };
}

export async function deleteInstanceService(
  instanceName: string,
  tenantId?:    string,
  isAdmin?:     boolean,
  overrideUrl?: string,
  overrideKey?: string,
  userId?:      string,
) {
  const meta = await getInstanceMeta(instanceName, tenantId, isAdmin, userId);

  if (!meta.found) {
    return { success: false, error: `Instância "${instanceName}" não encontrada ou sem permissão.` };
  }

  if (!meta.uuid) {
    console.warn(`[deleteInstanceService] UUID não encontrado para "${instanceName}" — removendo registro órfão.`);
    let logQ = supabaseAdmin.from('instances').select('id').eq('instance_name', instanceName);
    if (!isAdmin) {
      if (tenantId) logQ = logQ.eq('tenant_id', tenantId);
      if (userId)   logQ = logQ.eq('created_by', userId);
    }
    const { data: instRow } = await logQ.maybeSingle();
    if (instRow && (instRow as Record<string, unknown>).id) {
      await supabaseAdmin.from('instance_logs').delete().eq('instance_id', (instRow as Record<string, unknown>).id as string);
    }

    let delQ = supabaseAdmin.from('instances').delete().eq('instance_name', instanceName);
    if (!isAdmin) {
      if (tenantId) delQ = delQ.eq('tenant_id', tenantId);
      if (userId)   delQ = delQ.eq('created_by', userId);
    }
    await delQ;
    return { success: true, data: { message: 'Registro órfão removido do banco.' }, orphan: true };
  }

  const result = await callDelete(meta.uuid, overrideUrl, overrideKey);
  const apiOk = result.success || result.httpStatus === 404;

  if (!apiOk) {
    return {
      success:    false,
      error:      result.error || `A API retornou HTTP ${result.httpStatus}.`,
      httpStatus: result.httpStatus,
    };
  }

  let logQ = supabaseAdmin.from('instances').select('id').eq('instance_name', instanceName);
  if (!isAdmin) {
    if (tenantId) logQ = logQ.eq('tenant_id', tenantId);
    if (userId)   logQ = logQ.eq('created_by', userId);
  }
  const { data: instRow } = await logQ.maybeSingle();
  if (instRow && (instRow as Record<string, unknown>).id) {
    await supabaseAdmin.from('instance_logs').delete().eq('instance_id', (instRow as Record<string, unknown>).id as string);
  }

  let delQ = supabaseAdmin.from('instances').delete().eq('instance_name', instanceName);
  if (!isAdmin) {
    if (tenantId) delQ = delQ.eq('tenant_id', tenantId);
    if (userId)   delQ = delQ.eq('created_by', userId);
  }
  await delQ;

  return { success: true, data: result.data };
}

export async function forceDeleteInstance(instanceName: string) {
  const { data: inst } = await supabaseAdmin
    .from('instances')
    .select('id')
    .eq('instance_name', instanceName)
    .maybeSingle();

  if (!inst) {
    return { success: false, error: `Instância "${instanceName}" não encontrada.` };
  }

  if ((inst as Record<string, unknown>).id) {
    await supabaseAdmin.from('instance_logs').delete().eq('instance_id', (inst as Record<string, unknown>).id as string);
  }

  await supabaseAdmin.from('instances').delete().eq('instance_name', instanceName);

  console.log(`[forceDeleteInstance] ✅ "${instanceName}" removido do banco (force).`);
  return { success: true, data: { message: `Instância "${instanceName}" removida forçadamente do banco.` } };
}

export async function purgeOrphanedInstance(
  instanceName: string,
  tenantId?:    string,
  isAdmin?:     boolean,
  userId?:      string,
) {
  let q = supabaseAdmin.from('instances').select('id, instance_name, status').eq('instance_name', instanceName);
  if (!isAdmin) {
    if (tenantId) q = q.eq('tenant_id', tenantId);
    if (userId)   q = q.eq('created_by', userId);
  }
  const { data: inst } = await q.maybeSingle();

  if (!inst) return { success: false, error: `Instância "${instanceName}" não encontrada ou sem permissão.` };

  if ((inst as Record<string, unknown>).id) {
    await supabaseAdmin.from('instance_logs').delete().eq('instance_id', (inst as Record<string, unknown>).id as string);
  }

  let delQ = supabaseAdmin.from('instances').delete().eq('instance_name', instanceName);
  if (!isAdmin) {
    if (tenantId) delQ = delQ.eq('tenant_id', tenantId);
    if (userId)   delQ = delQ.eq('created_by', userId);
  }
  await delQ;

  console.log(`[purgeOrphanedInstance] ✅ "${instanceName}" removido do banco local.`);
  return { success: true, data: { message: `Instância "${instanceName}" removida do banco local.` } };
}
