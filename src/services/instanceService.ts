import pool from '../db/pool.js';
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
  let sql = `SELECT metadata FROM public.instances WHERE instance_name = $1`;
  const params: unknown[] = [instanceName];

  if (!isAdmin) {
    if (tenantId) { sql += ` AND tenant_id = $${params.length + 1}`; params.push(tenantId); }
    if (userId)   { sql += ` AND created_by = $${params.length + 1}`; params.push(userId); }
  }

  sql += ' LIMIT 1';
  const { rows } = await pool.query(sql, params);
  const inst = rows[0];

  if (!inst?.metadata) return { uuid: '', token: '', found: !!inst };
  const meta = inst.metadata as Record<string, unknown>;

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
  const { rows: existing } = await pool.query(
    `SELECT id, instance_name, status FROM public.instances WHERE instance_name = $1 AND tenant_id = $2 LIMIT 1`,
    [instanceName, tenantId]
  );

  if (existing.length) {
    return {
      success: false,
      error: `Instância "${instanceName}" já existe com status "${existing[0].status}".`,
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

  const { rows: inserted } = await pool.query(
    `INSERT INTO public.instances (instance_name, status, provider, tenant_id, created_by, metadata)
     VALUES ($1, 'active', 'evo-go', $2, $3, $4)
     RETURNING *`,
    [instanceName, tenantId, createdBy, JSON.stringify(metadata)]
  );

  const record = inserted[0];

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

  await pool.query(
    `INSERT INTO public.instance_logs (instance_id, event, payload) VALUES ($1, 'created', $2)`,
    [record.id, JSON.stringify({ create: createResult.data, connect: connectResult ? { success: connectResult.success, data: connectResult.data } : null })]
  );

  return {
    success: true,
    data: {
      ...record,
      status:           'active',
      instance_token:   instanceToken || null,
      create_response:  createResult.data,
      connect_response: connectResult?.data ?? null,
    },
  };
}

export async function listInstances(tenantId?: string, isAdmin = false, userId?: string) {
  let sql = `SELECT id, instance_name, status, provider, created_at, updated_at, metadata, tenant_id, created_by
             FROM public.instances`;
  const params: unknown[] = [];
  const conds: string[] = [];

  if (!isAdmin) {
    if (tenantId) { conds.push(`tenant_id = $${params.length + 1}`); params.push(tenantId); }
    if (userId)   { conds.push(`created_by = $${params.length + 1}`); params.push(userId); }
  }

  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY created_at DESC';

  try {
    const { rows } = await pool.query(sql, params);
    return { success: true, data: rows };
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
    let sql = `UPDATE public.instances SET status = 'inactive' WHERE instance_name = $1`;
    const params: unknown[] = [instanceName];
    if (!isAdmin) {
      if (tenantId) { sql += ` AND tenant_id = $${params.length + 1}`; params.push(tenantId); }
      if (userId)   { sql += ` AND created_by = $${params.length + 1}`; params.push(userId); }
    }
    await pool.query(sql, params);

    let qSql = `SELECT id FROM public.instances WHERE instance_name = $1`;
    const qParams: unknown[] = [instanceName];
    if (!isAdmin) {
      if (tenantId) { qSql += ` AND tenant_id = $${qParams.length + 1}`; qParams.push(tenantId); }
      if (userId)   { qSql += ` AND created_by = $${qParams.length + 1}`; qParams.push(userId); }
    }
    const { rows } = await pool.query(qSql + ' LIMIT 1', qParams);
    if (rows[0]?.id) {
      await pool.query(
        `INSERT INTO public.instance_logs (instance_id, event, payload) VALUES ($1, 'disconnected', $2)`,
        [rows[0].id, JSON.stringify(result.data ?? {})]
      );
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
    let sql = `UPDATE public.instances SET status = 'inactive' WHERE instance_name = $1`;
    const params: unknown[] = [instanceName];
    if (!isAdmin) {
      if (tenantId) { sql += ` AND tenant_id = $${params.length + 1}`; params.push(tenantId); }
      if (userId)   { sql += ` AND created_by = $${params.length + 1}`; params.push(userId); }
    }
    await pool.query(sql, params);

    let qSql = `SELECT id FROM public.instances WHERE instance_name = $1`;
    const qParams: unknown[] = [instanceName];
    if (!isAdmin) {
      if (tenantId) { qSql += ` AND tenant_id = $${qParams.length + 1}`; qParams.push(tenantId); }
      if (userId)   { qSql += ` AND created_by = $${qParams.length + 1}`; qParams.push(userId); }
    }
    const { rows } = await pool.query(qSql + ' LIMIT 1', qParams);
    if (rows[0]?.id) {
      await pool.query(
        `INSERT INTO public.instance_logs (instance_id, event, payload) VALUES ($1, 'logout', $2)`,
        [rows[0].id, JSON.stringify(result.data ?? {})]
      );
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
    let qSql = `SELECT id FROM public.instances WHERE instance_name = $1`;
    const qParams: unknown[] = [instanceName];
    if (!isAdmin) {
      if (tenantId) { qSql += ` AND tenant_id = $${qParams.length + 1}`; qParams.push(tenantId); }
      if (userId)   { qSql += ` AND created_by = $${qParams.length + 1}`; qParams.push(userId); }
    }
    const { rows } = await pool.query(qSql + ' LIMIT 1', qParams);
    if (rows[0]?.id) {
      await pool.query(`DELETE FROM public.instance_logs WHERE instance_id = $1`, [rows[0].id]);
    }
    let delSql = `DELETE FROM public.instances WHERE instance_name = $1`;
    const delParams: unknown[] = [instanceName];
    if (!isAdmin) {
      if (tenantId) { delSql += ` AND tenant_id = $${delParams.length + 1}`; delParams.push(tenantId); }
      if (userId)   { delSql += ` AND created_by = $${delParams.length + 1}`; delParams.push(userId); }
    }
    await pool.query(delSql, delParams);
    return { success: true, data: { message: 'Registro órfão removido do banco local.' }, orphan: true };
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

  let qSql = `SELECT id FROM public.instances WHERE instance_name = $1`;
  const qParams: unknown[] = [instanceName];
  if (!isAdmin) {
    if (tenantId) { qSql += ` AND tenant_id = $${qParams.length + 1}`; qParams.push(tenantId); }
    if (userId)   { qSql += ` AND created_by = $${qParams.length + 1}`; qParams.push(userId); }
  }
  const { rows } = await pool.query(qSql + ' LIMIT 1', qParams);
  if (rows[0]?.id) {
    await pool.query(`DELETE FROM public.instance_logs WHERE instance_id = $1`, [rows[0].id]);
  }

  let delSql = `DELETE FROM public.instances WHERE instance_name = $1`;
  const delParams: unknown[] = [instanceName];
  if (!isAdmin) {
    if (tenantId) { delSql += ` AND tenant_id = $${delParams.length + 1}`; delParams.push(tenantId); }
    if (userId)   { delSql += ` AND created_by = $${delParams.length + 1}`; delParams.push(userId); }
  }
  await pool.query(delSql, delParams);

  return { success: true, data: result.data };
}

export async function forceDeleteInstance(instanceName: string) {
  const { rows } = await pool.query(
    `SELECT id FROM public.instances WHERE instance_name = $1 LIMIT 1`,
    [instanceName]
  );

  if (!rows.length) {
    return { success: false, error: `Instância "${instanceName}" não encontrada.` };
  }

  if (rows[0]?.id) {
    await pool.query(`DELETE FROM public.instance_logs WHERE instance_id = $1`, [rows[0].id]);
  }

  await pool.query(`DELETE FROM public.instances WHERE instance_name = $1`, [instanceName]);

  console.log(`[forceDeleteInstance] ✅ "${instanceName}" removido do banco (force).`);
  return { success: true, data: { message: `Instância "${instanceName}" removida forçadamente do banco.` } };
}

export async function purgeOrphanedInstance(
  instanceName: string,
  tenantId?:    string,
  isAdmin?:     boolean,
  userId?:      string,
) {
  let sql = `SELECT id, instance_name, status FROM public.instances WHERE instance_name = $1`;
  const params: unknown[] = [instanceName];

  if (!isAdmin) {
    if (tenantId) { sql += ` AND tenant_id = $${params.length + 1}`; params.push(tenantId); }
    if (userId)   { sql += ` AND created_by = $${params.length + 1}`; params.push(userId); }
  }

  const { rows } = await pool.query(sql + ' LIMIT 1', params);
  if (!rows.length) return { success: false, error: `Instância "${instanceName}" não encontrada ou sem permissão.` };

  if (rows[0]?.id) {
    await pool.query(`DELETE FROM public.instance_logs WHERE instance_id = $1`, [rows[0].id]);
  }

  let delSql = `DELETE FROM public.instances WHERE instance_name = $1`;
  const delParams: unknown[] = [instanceName];
  if (!isAdmin) {
    if (tenantId) { delSql += ` AND tenant_id = $${delParams.length + 1}`; delParams.push(tenantId); }
    if (userId)   { delSql += ` AND created_by = $${delParams.length + 1}`; delParams.push(userId); }
  }
  await pool.query(delSql, delParams);

  console.log(`[purgeOrphanedInstance] ✅ "${instanceName}" removido do banco local.`);
  return { success: true, data: { message: `Instância "${instanceName}" removida do banco local.` } };
}
