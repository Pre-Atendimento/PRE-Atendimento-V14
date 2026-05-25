import '../load-env.js';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { runMigrations } from './db/migrate.js';
import pool from './db/pool.js';
import {
  createInstanceAndPersist,
  listInstances,
  disconnectInstanceService,
  logoutInstanceService,
  deleteInstanceService,
  purgeOrphanedInstance,
  forceDeleteInstance,
} from './services/instanceService.js';
import {
  getQrCode,
  connectInstance,
  getInstanceStatus,
  getAllInstances,
  pairInstance,
  getProfilePicture,
  reconnectInstance,
  updateAdvancedSettings,
} from './services/evolutionGo.js';
import { loginUser, registerUser, requestPasswordReset, resetPassword } from './services/authService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PORT       = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'pre-atendimento-default-secret';

/* ── JWT payload ─────────────────────────────────────────────────────── */
interface JwtPayload {
  userId:   string;
  tenantId: string;
  role:     string;
  name:     string;
  email:    string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function signEmbedToken(payload: JwtPayload): string {
  return jwt.sign({ ...payload, embed: true }, JWT_SECRET, { expiresIn: '30d' });
}

/* ── Middleware de autenticação JWT ─────────────────────────────────── */
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Autenticação necessária.' });
    return;
  }
  try {
    const token   = auth.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Token inválido ou expirado. Faça login novamente.' });
  }
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Acesso restrito a administradores.' });
    return;
  }
  next();
}

/* ── Extrai token de instância do metadata ─────────────────────────── */
function extractInstanceToken(meta: Record<string, unknown>): string {
  const newData = (meta.create as Record<string, unknown> | undefined)
    ?.data as Record<string, unknown> | undefined;
  if (newData?.token)  return String(newData.token);
  if (newData?.apikey) return String(newData.apikey);

  const oldData = meta.data as Record<string, unknown> | undefined;
  if (oldData?.token)  return String(oldData.token);
  if (oldData?.apikey) return String(oldData.apikey);

  if (meta.token)  return String(meta.token);
  if (meta.apikey) return String(meta.apikey);
  return '';
}

/* ── Sanitize header value ──────────────────────────────────────────── */
function sanitizeHeaderValue(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, '').trim();
}

/* ── Helper: resolve EvoAI CRM config from system_config ─────────── */
async function getEvoCRMConfig(): Promise<{ url: string; token: string } | null> {
  const { rows } = await pool.query(
    `SELECT key, value FROM public.system_config WHERE key IN ('evo_crm_url', 'evo_crm_token')`
  );
  const url   = rows.find((r: { key: string; value: string }) => r.key === 'evo_crm_url')?.value?.trim()   || '';
  const token = sanitizeHeaderValue(rows.find((r: { key: string; value: string }) => r.key === 'evo_crm_token')?.value || '');
  if (!url || !token) return null;
  return { url, token };
}

/* ── Helper: resolve EvoGo config from system_config ─────────────── */
async function getEvoGoConfig(): Promise<{ url: string; key: string }> {
  const { rows } = await pool.query(
    `SELECT key, value FROM public.system_config WHERE key IN ('evogo_url', 'evogo_api_key')`
  );
  const url = rows.find((r: { key: string; value: string }) => r.key === 'evogo_url')?.value?.trim()     || '';
  const key = rows.find((r: { key: string; value: string }) => r.key === 'evogo_api_key')?.value?.trim() || '';
  if (!url || !key) {
    throw new Error('EvoGo não configurado. Acesse Configuração → EvoGo.');
  }
  return { url, key };
}

/* ── Express setup ──────────────────────────────────────────────────── */
const app = express();
app.use(cors());
app.use(express.json());

/* Permitir embedding em iframe */
app.use((_req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  next();
});

/* Anti-cache para HTML */
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

app.use(express.static(path.join(__dirname, '../public')));

/* ── Embed bridge ─────────────────────────────────────────────────── */
app.get('/embed', (req, res) => {
  const token = (req.query.t as string || '').trim();
  if (!token) { res.redirect('/'); return; }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload & { embed?: boolean };
    const session = JSON.stringify({
      userId    : payload.userId,
      email     : payload.email,
      role      : payload.role,
      name      : payload.name,
      tenantId  : payload.tenantId,
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8">
<script>
try {
  localStorage.setItem('pa_jwt', ${JSON.stringify(token)});
  localStorage.setItem('pa_session', ${JSON.stringify(session)});
} catch(e) {}
window.location.replace('/dashboard.html');
</script></head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f1117;color:#94a3b8">
  <span>Carregando…</span>
</body></html>`);
  } catch {
    res.redirect('/');
  }
});

/* ── Gerar token de embed ─────────────────────────────────────────── */
app.get('/api/admin/embed-token', requireAuth, async (req, res) => {
  try {
    const user  = req.user!;
    const token = signEmbedToken({
      userId  : user.userId,
      email   : user.email,
      role    : user.role,
      name    : user.name,
      tenantId: user.tenantId,
    });

    const host         = (req.headers['x-forwarded-host'] || req.headers.host || '') as string;
    const protocol     = (req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')) as string;
    const requestBase  = `${protocol}://${host}`;
    const publicAppUrl = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');

    const isDevDomain  = host.includes('replit.dev') || host.includes('janeway') || host.includes('riker');
    const baseUrl      = (publicAppUrl && !publicAppUrl.includes('replit.dev')) ? publicAppUrl : requestBase;
    const embedUrl     = `${baseUrl}/embed?t=${token}`;

    res.json({
      success   : true,
      token,
      embedUrl,
      isDevDomain: isDevDomain && !publicAppUrl,
      warning   : (isDevDomain && !publicAppUrl)
        ? 'URL gerada a partir do ambiente de desenvolvimento. Acesse o app publicado (.replit.app) para gerar um link embeddável.'
        : null,
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

app.get('/api/config', (_req, res) => {
  const dbConfigured = !!process.env.DATABASE_URL;
  res.json({ jwtConfigured: true, dbConfigured, ready: dbConfigured, missing: dbConfigured ? [] : ['DATABASE_URL'] });
});

app.get('/health', (_req, res) => {
  res.json({ message: '✅ PRE-Atendimento-V8 iniciado com sucesso!', version: '1.0.0', status: 'running' });
});

/* ── Setup: criar primeiro admin (só funciona quando não há usuários) ── */
app.post('/api/setup', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT COUNT(*) FROM public.users');
    if (parseInt(existing[0].count, 10) > 0) {
      res.status(403).json({ success: false, error: 'Setup já realizado. Endpoint desativado.' });
      return;
    }
    const { name, email, password } = req.body as { name?: string; email?: string; password?: string };
    if (!name || !email || !password) {
      res.status(400).json({ success: false, error: 'Nome, e-mail e senha são obrigatórios.' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ success: false, error: 'Senha deve ter pelo menos 6 caracteres.' });
      return;
    }
    const result = await registerUser(name, email, password, 'admin');
    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    res.status(201).json({ success: true, message: 'Admin criado com sucesso! Faça login agora.' });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Auth: Login ─────────────────────────────────────────────────────── */
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ success: false, error: 'E-mail e senha são obrigatórios.' });
    return;
  }
  try {
    const result = await loginUser(email, password);
    if (!result.success || !result.user) {
      res.status(401).json(result);
      return;
    }
    const { id, name, role, tenantId, tenantName, tenantSlug } = result.user;
    const token = signToken({ userId: id, tenantId: tenantId || '', role, name, email: result.user.email });
    res.json({
      success: true,
      token,
      user: { id, name, email: result.user.email, role, tenantId, tenantName, tenantSlug },
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Auth: Register ──────────────────────────────────────────────────── */
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, tenantId } = req.body as {
    name?: string; email?: string; password?: string; tenantId?: string;
  };
  if (!name || !email || !password) {
    res.status(400).json({ success: false, error: 'Nome, e-mail e senha são obrigatórios.' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ success: false, error: 'A senha deve ter pelo menos 6 caracteres.' });
    return;
  }
  try {
    const result = await registerUser(name, email, password, 'user', tenantId);
    res.status(result.success ? 201 : 409).json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Auth: Recuperar senha ───────────────────────────────────────────── */
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ success: false, error: 'E-mail é obrigatório.' });
    return;
  }
  try {
    const publicUrl =
      process.env.PUBLIC_APP_URL?.replace(/\/$/, '') ||
      (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null) ||
      (() => {
        const protocol = (req.headers['x-forwarded-proto'] as string)?.split(',')[0].trim() || req.protocol || 'https';
        const host     = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:5000';
        return `${protocol}://${host}`;
      })();
    const redirectTo = `${publicUrl}/reset-password.html`;
    await requestPasswordReset(email, redirectTo);
    res.json({
      success: true,
      message: 'Se este e-mail estiver cadastrado, você receberá o link em instantes. Verifique também a pasta de spam.',
    });
  } catch {
    res.json({
      success: true,
      message: 'Se este e-mail estiver cadastrado, você receberá o link em instantes. Verifique também a pasta de spam.',
    });
  }
});

/* ── Auth: Redefinir senha ───────────────────────────────────────────── */
app.post('/api/auth/reset-password', async (req, res) => {
  const { access_token, password } = req.body as { access_token?: string; password?: string };
  if (!access_token || !password) {
    res.status(400).json({ success: false, error: 'Token e senha são obrigatórios.' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ success: false, error: 'A senha deve ter pelo menos 6 caracteres.' });
    return;
  }
  try {
    const result = await resetPassword(access_token, password);
    res.status(result.success ? 200 : 401).json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Auth: Verificar token ───────────────────────────────────────────── */
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

/* ── Tenants ─────────────────────────────────────────────────────────── */
app.get('/api/tenants', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, slug, active, created_at FROM public.tenants ORDER BY created_at ASC`
    );
    res.json({ success: true, data: rows });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

app.post('/api/tenants', requireAuth, requireAdmin, async (req, res) => {
  const { name, slug } = req.body as { name?: string; slug?: string };
  if (!name || !slug) {
    res.status(400).json({ success: false, error: 'name e slug são obrigatórios.' });
    return;
  }
  try {
    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const { rows } = await pool.query(
      `INSERT INTO public.tenants (name, slug) VALUES ($1, $2) RETURNING id, name, slug, active, created_at`,
      [name, cleanSlug]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err: unknown) {
    res.status(409).json({ success: false, error: (err as Error).message });
  }
});

app.patch('/api/tenants/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { active } = req.body as { active?: boolean };
  if (typeof active !== 'boolean') {
    res.status(400).json({ success: false, error: 'Campo "active" (boolean) é obrigatório.' });
    return;
  }
  try {
    const { rows } = await pool.query(
      `UPDATE public.tenants SET active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, slug, active, created_at`,
      [active, id]
    );
    if (!rows.length) { res.status(404).json({ success: false, error: 'Tenant não encontrado.' }); return; }
    res.json({ success: true, data: rows[0] });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

app.delete('/api/tenants/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM public.tenants WHERE id = $1`, [id]);
    res.json({ success: true, data: { message: 'Tenant excluído com sucesso.' } });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Usuários (admin) ────────────────────────────────────────────────── */
app.get('/api/users', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.active, u.tenant_id, u.created_at, u.max_instances,
              t.name AS tenant_name, t.slug AS tenant_slug
       FROM public.users u
       LEFT JOIN public.tenants t ON t.id = u.tenant_id
       ORDER BY u.created_at ASC`
    );
    const data = rows.map((r: Record<string, unknown>) => ({
      ...r,
      tenants: r.tenant_name ? { name: r.tenant_name, slug: r.tenant_slug } : null,
    }));
    res.json({ success: true, data });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  const { name, email, password, role, tenantId } = req.body as {
    name?: string; email?: string; password?: string; role?: string; tenantId?: string;
  };
  if (!name || !email || !password) {
    res.status(400).json({ success: false, error: 'Nome, e-mail e senha são obrigatórios.' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ success: false, error: 'A senha deve ter pelo menos 6 caracteres.' });
    return;
  }
  try {
    const result = await registerUser(name, email, password, role || 'user', tenantId);
    res.status(result.success ? 201 : 409).json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

app.patch('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { role, name, active, tenantId, maxInstances } = req.body as {
    role?: string; name?: string; active?: boolean; tenantId?: string | null; maxInstances?: number | null;
  };

  if (maxInstances !== undefined && maxInstances !== null) {
    const v = Number(maxInstances);
    if (!Number.isInteger(v) || v < 1 || v > 5) {
      res.status(400).json({ success: false, error: 'Limite inválido. Use um número inteiro entre 1 e 5.' });
      return;
    }
  }

  const setClauses: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [];

  if (role !== undefined)         { params.push(role);                   setClauses.push(`role = $${params.length}`); }
  if (name !== undefined)         { params.push(name.trim());            setClauses.push(`name = $${params.length}`); }
  if (active !== undefined)       { params.push(active);                 setClauses.push(`active = $${params.length}`); }
  if (tenantId !== undefined)     { params.push(tenantId ?? null);       setClauses.push(`tenant_id = $${params.length}`); }
  if (maxInstances !== undefined) { params.push(maxInstances ?? null);   setClauses.push(`max_instances = $${params.length}`); }

  if (params.length === 0) {
    res.status(400).json({ success: false, error: 'Nenhum campo para atualizar.' });
    return;
  }

  params.push(id);
  try {
    const { rows } = await pool.query(
      `UPDATE public.users SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING id, name, email, role, active, tenant_id`,
      params
    );
    if (!rows.length) { res.status(404).json({ success: false, error: 'Usuário não encontrado.' }); return; }
    res.json({ success: true, data: rows[0] });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (id === req.user!.userId) {
    res.status(400).json({ success: false, error: 'Você não pode excluir a própria conta.' });
    return;
  }
  try {
    await pool.query(`DELETE FROM public.users WHERE id = $1`, [id]);
    res.json({ success: true, data: { message: 'Usuário removido com sucesso.' } });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Criar instância ─────────────────────────────────────────────────── */
app.post('/api/instances', requireAuth, async (req, res) => {
  const { instanceName, token, tenantId } = req.body as {
    instanceName?: string; token?: string; tenantId?: string;
  };

  if (!instanceName || typeof instanceName !== 'string' || instanceName.trim() === '') {
    res.status(400).json({ success: false, error: 'instanceName é obrigatório.' });
    return;
  }

  const INST_NAME_RE = /^[a-zA-Z0-9_-]+$/;
  if (!INST_NAME_RE.test(instanceName.trim())) {
    res.status(400).json({ success: false, error: 'Nome inválido. Use apenas letras (a-z), números, hífen (-) e underscore (_).' });
    return;
  }

  const user = req.user!;
  const effectiveTenantId = (user.role === 'admin' && tenantId) ? tenantId : (user.tenantId || tenantId || '');

  if (!effectiveTenantId) {
    res.status(400).json({ success: false, error: 'Tenant não identificado. Faça login novamente.' });
    return;
  }

  if (user.role !== 'admin') {
    const { rows: userRows } = await pool.query(
      `SELECT max_instances FROM public.users WHERE id = $1 LIMIT 1`, [user.userId]
    );
    const limit = userRows[0]?.max_instances ?? null;
    if (limit !== null) {
      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*) FROM public.instances WHERE created_by = $1`, [user.userId]
      );
      if (parseInt(countRows[0].count, 10) >= limit) {
        res.status(403).json({ success: false, error: 'Limite de instâncias atingido. Peça ao administrador para aumentar seu limite.' });
        return;
      }
    }
  }

  let _evoCreate: { url: string; key: string };
  try { _evoCreate = await getEvoGoConfig(); }
  catch { res.status(400).json({ success: false, error: 'EvoGo não configurado. Acesse Configuração → EvoGo.' }); return; }

  try {
    const result = await createInstanceAndPersist(
      instanceName.trim(),
      effectiveTenantId,
      user.userId,
      token,
      _evoCreate.url,
      _evoCreate.key,
    );
    res.status(result.success ? 201 : 409).json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Listar instâncias ───────────────────────────────────────────────── */
app.get('/api/instances', requireAuth, async (req, res) => {
  const user    = req.user!;
  const isAdmin = user.role === 'admin';
  try {
    const result = await listInstances(
      isAdmin ? undefined : user.tenantId,
      isAdmin,
      isAdmin ? undefined : user.userId,
    );
    res.status(result.success ? 200 : 500).json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── QR Code ─────────────────────────────────────────────────────────── */
app.get('/api/instances/:name/qr', requireAuth, async (req, res) => {
  const { name } = req.params;
  const user     = req.user!;
  const isAdmin  = user.role === 'admin';

  try {
    let sql = `SELECT metadata FROM public.instances WHERE instance_name = $1`;
    const params: unknown[] = [name];
    if (!isAdmin) {
      if (user.tenantId) { sql += ` AND tenant_id = $${params.length + 1}`; params.push(user.tenantId); }
      sql += ` AND created_by = $${params.length + 1}`; params.push(user.userId);
    }
    const { rows } = await pool.query(sql + ' LIMIT 1', params);
    if (!rows.length) { res.status(404).json({ success: false, error: 'Instância não encontrada.' }); return; }

    const meta  = (rows[0].metadata as Record<string, unknown>) || {};
    const token = extractInstanceToken(meta);
    if (!token) { res.status(400).json({ success: false, error: 'Token da instância não encontrado.' }); return; }

    let _evo: { url: string; key: string };
    try { _evo = await getEvoGoConfig(); }
    catch { res.status(400).json({ success: false, error: 'EvoGo não configurado.' }); return; }

    const result = await getQrCode(token, _evo.url);
    res.status(result.success ? 200 : (result.httpStatus || 502)).json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Status de instância ─────────────────────────────────────────────── */
app.get('/api/instances/:name/status', requireAuth, async (req, res) => {
  const { name } = req.params;
  const user     = req.user!;
  const isAdmin  = user.role === 'admin';

  try {
    let sql = `SELECT metadata FROM public.instances WHERE instance_name = $1`;
    const params: unknown[] = [name];
    if (!isAdmin) {
      if (user.tenantId) { sql += ` AND tenant_id = $${params.length + 1}`; params.push(user.tenantId); }
      sql += ` AND created_by = $${params.length + 1}`; params.push(user.userId);
    }
    const { rows } = await pool.query(sql + ' LIMIT 1', params);
    if (!rows.length) { res.status(404).json({ success: false, error: 'Instância não encontrada.' }); return; }

    const meta  = (rows[0].metadata as Record<string, unknown>) || {};
    const token = extractInstanceToken(meta);
    if (!token) { res.status(400).json({ success: false, error: 'Token da instância não encontrado.' }); return; }

    let _evo: { url: string; key: string };
    try { _evo = await getEvoGoConfig(); }
    catch { res.status(400).json({ success: false, error: 'EvoGo não configurado.' }); return; }

    const result = await getInstanceStatus(token, _evo.url);
    res.status(result.success ? 200 : (result.httpStatus || 502)).json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Conectar instância ──────────────────────────────────────────────── */
app.post('/api/instances/:name/connect', requireAuth, async (req, res) => {
  const { name } = req.params;
  const user     = req.user!;
  const isAdmin  = user.role === 'admin';
  const { webhookUrl, subscribe, rabbitmqEnable, websocketEnable, natsEnable } = req.body as {
    webhookUrl?: string; subscribe?: string[]; rabbitmqEnable?: string;
    websocketEnable?: string; natsEnable?: string;
  };

  try {
    let sql = `SELECT metadata FROM public.instances WHERE instance_name = $1`;
    const params: unknown[] = [name];
    if (!isAdmin) {
      if (user.tenantId) { sql += ` AND tenant_id = $${params.length + 1}`; params.push(user.tenantId); }
      sql += ` AND created_by = $${params.length + 1}`; params.push(user.userId);
    }
    const { rows } = await pool.query(sql + ' LIMIT 1', params);
    if (!rows.length) { res.status(404).json({ success: false, error: 'Instância não encontrada.' }); return; }

    const meta  = (rows[0].metadata as Record<string, unknown>) || {};
    const token = extractInstanceToken(meta);
    if (!token) { res.status(400).json({ success: false, error: 'Token da instância não encontrado.' }); return; }

    let _evo: { url: string; key: string };
    try { _evo = await getEvoGoConfig(); }
    catch { res.status(400).json({ success: false, error: 'EvoGo não configurado.' }); return; }

    const result = await connectInstance(token, _evo.url, { webhookUrl, subscribe, rabbitmqEnable, websocketEnable, natsEnable });
    res.status(result.success ? 200 : (result.httpStatus || 502)).json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Reconectar instância ────────────────────────────────────────────── */
app.post('/api/instances/:name/reconnect', requireAuth, async (req, res) => {
  const { name } = req.params;
  const user     = req.user!;
  const isAdmin  = user.role === 'admin';
  const { webhookUrl, subscribe, rabbitmqEnable, websocketEnable, natsEnable } = req.body as {
    webhookUrl?: string; subscribe?: string[]; rabbitmqEnable?: string;
    websocketEnable?: string; natsEnable?: string;
  };

  try {
    let sql = `SELECT metadata FROM public.instances WHERE instance_name = $1`;
    const params: unknown[] = [name];
    if (!isAdmin) {
      if (user.tenantId) { sql += ` AND tenant_id = $${params.length + 1}`; params.push(user.tenantId); }
      sql += ` AND created_by = $${params.length + 1}`; params.push(user.userId);
    }
    const { rows } = await pool.query(sql + ' LIMIT 1', params);
    if (!rows.length) { res.status(404).json({ success: false, error: 'Instância não encontrada.' }); return; }

    const meta  = (rows[0].metadata as Record<string, unknown>) || {};
    const token = extractInstanceToken(meta);
    if (!token) { res.status(400).json({ success: false, error: 'Token da instância não encontrado.' }); return; }

    let _evo: { url: string; key: string };
    try { _evo = await getEvoGoConfig(); }
    catch { res.status(400).json({ success: false, error: 'EvoGo não configurado.' }); return; }

    const result = await reconnectInstance(token, _evo.url, { webhookUrl, subscribe, rabbitmqEnable, websocketEnable, natsEnable });
    res.status(result.success ? 200 : (result.httpStatus || 502)).json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Desconectar instância ───────────────────────────────────────────── */
app.post('/api/instances/:name/disconnect', requireAuth, async (req, res) => {
  const { name }    = req.params;
  const user        = req.user!;
  const isAdmin     = user.role === 'admin';
  const { instanceToken, evogoUrl } = req.body as { instanceToken?: string; evogoUrl?: string };

  let _evo: { url: string; key: string };
  try { _evo = await getEvoGoConfig(); }
  catch { res.status(400).json({ success: false, error: 'EvoGo não configurado.' }); return; }

  try {
    const result = await disconnectInstanceService(
      name, isAdmin ? undefined : user.tenantId, isAdmin,
      instanceToken, evogoUrl || _evo.url,
      isAdmin ? undefined : user.userId,
    );
    res.status(result.success ? 200 : 500).json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Logout de instância ─────────────────────────────────────────────── */
app.post('/api/instances/:name/logout', requireAuth, async (req, res) => {
  const { name }    = req.params;
  const user        = req.user!;
  const isAdmin     = user.role === 'admin';
  const { instanceToken, evogoUrl } = req.body as { instanceToken?: string; evogoUrl?: string };

  let _evo: { url: string; key: string };
  try { _evo = await getEvoGoConfig(); }
  catch { res.status(400).json({ success: false, error: 'EvoGo não configurado.' }); return; }

  try {
    const result = await logoutInstanceService(
      name, isAdmin ? undefined : user.tenantId, isAdmin,
      instanceToken, evogoUrl || _evo.url,
      isAdmin ? undefined : user.userId,
    );
    res.status(result.success ? 200 : 500).json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Deletar instância ───────────────────────────────────────────────── */
app.delete('/api/instances/:name', requireAuth, async (req, res) => {
  const { name } = req.params;
  const user     = req.user!;
  const isAdmin  = user.role === 'admin';
  const { evogoUrl, evogoKey } = req.query as { evogoUrl?: string; evogoKey?: string };

  let _evo: { url: string; key: string };
  try { _evo = await getEvoGoConfig(); }
  catch { res.status(400).json({ success: false, error: 'EvoGo não configurado.' }); return; }

  try {
    const result = await deleteInstanceService(
      name, isAdmin ? undefined : user.tenantId, isAdmin,
      evogoUrl || _evo.url, evogoKey || _evo.key,
      isAdmin ? undefined : user.userId,
    );
    res.status(result.success ? 200 : (result.httpStatus || 500)).json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Purgar instância órfã ───────────────────────────────────────────── */
app.delete('/api/instances/:name/purge', requireAuth, async (req, res) => {
  const { name } = req.params;
  const user     = req.user!;
  const isAdmin  = user.role === 'admin';

  try {
    const result = await purgeOrphanedInstance(
      name,
      isAdmin ? undefined : user.tenantId,
      isAdmin,
      isAdmin ? undefined : user.userId,
    );
    res.status(result.success ? 200 : 404).json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Force delete (admin) ────────────────────────────────────────────── */
app.delete('/api/admin/instances/:name/force', requireAuth, requireAdmin, async (req, res) => {
  const { name } = req.params;
  try {
    const result = await forceDeleteInstance(name);
    res.status(result.success ? 200 : 404).json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Pair instance ───────────────────────────────────────────────────── */
app.post('/api/instances/:name/pair', requireAuth, async (req, res) => {
  const { name } = req.params;
  const user     = req.user!;
  const isAdmin  = user.role === 'admin';
  const { phone, subscribe } = req.body as { phone?: string; subscribe?: string[] };

  if (!phone) { res.status(400).json({ success: false, error: 'Número de telefone é obrigatório.' }); return; }

  try {
    let sql = `SELECT metadata FROM public.instances WHERE instance_name = $1`;
    const params: unknown[] = [name];
    if (!isAdmin) {
      if (user.tenantId) { sql += ` AND tenant_id = $${params.length + 1}`; params.push(user.tenantId); }
      sql += ` AND created_by = $${params.length + 1}`; params.push(user.userId);
    }
    const { rows } = await pool.query(sql + ' LIMIT 1', params);
    if (!rows.length) { res.status(404).json({ success: false, error: 'Instância não encontrada.' }); return; }

    const meta  = (rows[0].metadata as Record<string, unknown>) || {};
    const token = extractInstanceToken(meta);
    if (!token) { res.status(400).json({ success: false, error: 'Token da instância não encontrado.' }); return; }

    let _evo: { url: string; key: string };
    try { _evo = await getEvoGoConfig(); }
    catch { res.status(400).json({ success: false, error: 'EvoGo não configurado.' }); return; }

    const result = await pairInstance(token, phone, subscribe, _evo.url);
    res.status(result.success ? 200 : (result.httpStatus || 502)).json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Profile picture ─────────────────────────────────────────────────── */
app.get('/api/instances/:name/profile-picture', requireAuth, async (req, res) => {
  const { name } = req.params;
  const user     = req.user!;
  const isAdmin  = user.role === 'admin';

  try {
    let sql = `SELECT metadata FROM public.instances WHERE instance_name = $1`;
    const params: unknown[] = [name];
    if (!isAdmin) {
      if (user.tenantId) { sql += ` AND tenant_id = $${params.length + 1}`; params.push(user.tenantId); }
      sql += ` AND created_by = $${params.length + 1}`; params.push(user.userId);
    }
    const { rows } = await pool.query(sql + ' LIMIT 1', params);
    if (!rows.length) { res.status(404).json({ success: false, error: 'Instância não encontrada.' }); return; }

    const meta  = (rows[0].metadata as Record<string, unknown>) || {};
    const token = extractInstanceToken(meta);
    if (!token) { res.status(400).json({ success: false, error: 'Token não encontrado.' }); return; }

    let _evo: { url: string; key: string };
    try { _evo = await getEvoGoConfig(); }
    catch { res.status(400).json({ success: false, error: 'EvoGo não configurado.' }); return; }

    const result = await getProfilePicture(token, _evo.url);
    res.status(result.success ? 200 : (result.httpStatus || 502)).json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Salvar configurações avançadas ──────────────────────────────────── */
app.post('/api/instances/:name/advanced', requireAuth, async (req, res) => {
  const { name } = req.params;
  const user     = req.user!;
  const isAdmin  = user.role === 'admin';
  const { alwaysOnline, rejectCall, readMessages, ignoreGroups, ignoreStatus } = req.body as {
    alwaysOnline?: boolean; rejectCall?: boolean; readMessages?: boolean;
    ignoreGroups?: boolean; ignoreStatus?: boolean;
  };
  try {
    let sql = `SELECT metadata FROM public.instances WHERE instance_name = $1`;
    const params: unknown[] = [name];
    if (!isAdmin) {
      if (user.tenantId) { sql += ` AND tenant_id = $${params.length + 1}`; params.push(user.tenantId); }
      sql += ` AND created_by = $${params.length + 1}`; params.push(user.userId);
    }
    const { rows } = await pool.query(sql + ' LIMIT 1', params);
    if (!rows.length) { res.status(404).json({ success: false, error: 'Instância não encontrada.' }); return; }

    const meta = ((rows[0].metadata as Record<string, unknown>) || {}) as Record<string, unknown>;
    meta.advanced = {
      alwaysOnline: !!alwaysOnline, rejectCall: !!rejectCall,
      readMessages: !!readMessages, ignoreGroups: !!ignoreGroups, ignoreStatus: !!ignoreStatus,
    };

    let upSql = `UPDATE public.instances SET metadata = $1, updated_at = NOW() WHERE instance_name = $2`;
    const upParams: unknown[] = [JSON.stringify(meta), name];
    if (!isAdmin) {
      if (user.tenantId) { upSql += ` AND tenant_id = $${upParams.length + 1}`; upParams.push(user.tenantId); }
      upSql += ` AND created_by = $${upParams.length + 1}`; upParams.push(user.userId);
    }
    await pool.query(upSql, upParams);

    const createData = (meta.create as Record<string, unknown>)?.data as Record<string, unknown> | undefined
                    || (meta.data as Record<string, unknown> | undefined);
    const instanceUuid  = (createData?.id    as string) || '';
    const instanceToken = (createData?.token as string) || '';
    if (instanceUuid && instanceToken) {
      try {
        const _evo = await getEvoGoConfig();
        await updateAdvancedSettings(instanceUuid, {
          alwaysOnline: !!alwaysOnline, rejectCall: !!rejectCall,
          readMessages: !!readMessages, ignoreGroups: !!ignoreGroups, ignoreStatus: !!ignoreStatus,
        }, _evo.url, instanceToken);
      } catch (evoErr) {
        console.warn('[Advanced] EvoGo update falhou (salvo localmente):', (evoErr as Error).message);
      }
    }

    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Admin: Atribuir dono de instância ──────────────────────────────── */
app.patch('/api/instances/:name/owner', requireAuth, requireAdmin, async (req, res) => {
  const { name }   = req.params;
  const { userId } = req.body as { userId?: string };

  if (userId === undefined) {
    res.status(400).json({ success: false, error: 'userId é obrigatório (envie null para remover a atribuição).' });
    return;
  }

  try {
    let owner: { id: string; name: string; email: string; role: string } | null = null;
    if (userId) {
      const { rows } = await pool.query(
        `SELECT id, name, email, role FROM public.users WHERE id = $1 LIMIT 1`, [userId]
      );
      if (!rows.length) { res.status(404).json({ success: false, error: 'Usuário não encontrado.' }); return; }
      owner = rows[0];
    }

    const { rows } = await pool.query(
      `UPDATE public.instances SET created_by = $1, updated_at = NOW() WHERE instance_name = $2
       RETURNING id, instance_name, created_by, tenant_id`,
      [userId || null, name]
    );
    if (!rows.length) { res.status(404).json({ success: false, error: 'Instância não encontrada.' }); return; }

    res.json({
      success: true,
      data: { ...rows[0], owner: owner ? { id: owner.id, name: owner.name, email: owner.email, role: owner.role } : null },
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Admin: Listar instâncias na EvoGo API ───────────────────────────── */
app.get('/api/admin/instances', requireAuth, requireAdmin, async (_req, res) => {
  let _adminEvo: { url: string; key: string };
  try { _adminEvo = await getEvoGoConfig(); }
  catch { res.status(400).json({ success: false, error: 'EvoGo não configurado. Acesse Configuração → EvoGo.' }); return; }
  try {
    const result = await getAllInstances(_adminEvo.url, _adminEvo.key);
    res.status(result.success ? 200 : (result.httpStatus || 502)).json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Admin: Testar conexão EvoGo ─────────────────────────────────────── */
app.post('/api/admin/test-connection', requireAuth, requireAdmin, async (req, res) => {
  const { evogoUrl, apiKey } = req.body as { evogoUrl?: string; apiKey?: string };
  let baseUrl = evogoUrl?.trim() || '';
  let key     = apiKey?.trim()   || '';

  if (!baseUrl || !key) {
    try {
      const { rows } = await pool.query(
        `SELECT key, value FROM public.system_config WHERE key IN ('evogo_url', 'evogo_api_key')`
      );
      if (!baseUrl) baseUrl = rows.find((r: { key: string; value: string }) => r.key === 'evogo_url')?.value?.trim()     || '';
      if (!key)     key     = rows.find((r: { key: string; value: string }) => r.key === 'evogo_api_key')?.value?.trim() || '';
    } catch { /* continue */ }
  }

  if (!baseUrl) { res.status(400).json({ success: false, error: 'URL da API não configurada.' }); return; }
  if (!key)     { res.status(400).json({ success: false, error: 'Chave da API não configurada.' }); return; }

  const url = `${baseUrl}/instance/all`;
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 10_000);

  try {
    const r = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json', apikey: key }, signal: controller.signal });
    clearTimeout(timeout);
    const text = await r.text();
    if (r.ok) {
      res.json({ success: true, status: r.status, message: 'Conexão estabelecida com sucesso.' });
    } else {
      res.json({ success: false, status: r.status, error: `API retornou HTTP ${r.status}.`, detail: text.slice(0, 300) });
    }
  } catch (err: unknown) {
    clearTimeout(timeout);
    const isTimeout = (err as Error).name === 'AbortError';
    res.status(502).json({ success: false, error: isTimeout ? 'Tempo limite esgotado (10s).' : `Falha de rede: ${(err as Error).message}` });
  }
});

/* ── Monitor ─────────────────────────────────────────────────────────── */
app.get('/api/monitor', requireAuth, async (req, res) => {
  const user    = req.user!;
  const isAdmin = user.role === 'admin';
  try {
    const result = await listInstances(
      isAdmin ? undefined : user.tenantId, isAdmin, isAdmin ? undefined : user.userId,
    );
    const checkedAt = new Date().toISOString();
    const instances = (result.data as Array<Record<string, unknown>>) || [];
    if (!result.success || !instances.length) {
      res.json({ success: true, data: [], checkedAt }); return;
    }

    const hasId = (inst: Record<string, unknown>): boolean => {
      const meta  = (inst.metadata as Record<string, unknown>) || {};
      const newId = ((meta.create as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined)?.id;
      const oldId = (meta.data as Record<string, unknown> | undefined)?.id;
      return !!(newId || oldId);
    };
    const orphanData = instances
      .filter(inst => !hasId(inst))
      .map(inst => ({ name: inst.instance_name as string, connected: false, orphan: true, checkedAt }));
    const nonOrphans = instances.filter(hasId);

    let _monEvoUrl: string | undefined;
    try { const cfg = await getEvoGoConfig(); _monEvoUrl = cfg.url; } catch { _monEvoUrl = undefined; }

    const settled = await Promise.allSettled(
      nonOrphans.map(async (inst) => {
        const name  = inst.instance_name as string;
        const meta  = (inst.metadata as Record<string, unknown>) || {};
        const token = extractInstanceToken(meta);
        try {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => { const e = new Error('Monitor timeout'); e.name = 'AbortError'; reject(e); }, 6000)
          );
          const st    = await Promise.race([getInstanceStatus(token, _monEvoUrl), timeoutPromise]);
          const d     = (st.data as Record<string, unknown>) || {};
          const inner = (d.data as Record<string, unknown>) || {};
          const loggedIn = inner.LoggedIn === true;
          return { name, connected: loggedIn, status: loggedIn ? 'connected' : 'disconnected', orphan: false, checkedAt };
        } catch (err: unknown) {
          const isTimeout = (err as Error)?.name === 'AbortError';
          return { name, connected: false, status: isTimeout ? 'failure' : 'error', orphan: false, checkedAt };
        }
      }),
    );
    const activeData = settled.map(r => r.status === 'fulfilled'
      ? r.value
      : { name: '?', connected: false, status: 'failure', orphan: false, checkedAt });
    res.json({ success: true, data: [...orphanData, ...activeData], checkedAt });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Admin: Ler config EvoGo ─────────────────────────────────────────── */
app.get('/api/admin/config/evogo', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT key, value FROM public.system_config WHERE key IN ('evogo_url', 'evogo_api_key')`
    );
    const url  = rows.find((r: { key: string; value: string }) => r.key === 'evogo_url')?.value?.trim()     || '';
    const key  = rows.find((r: { key: string; value: string }) => r.key === 'evogo_api_key')?.value?.trim() || '';
    res.json({ success: true, url, keyConfigured: !!key });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ── Admin: Salvar config EvoGo ──────────────────────────────────────── */
app.post('/api/admin/config/evogo', requireAuth, requireAdmin, async (req, res) => {
  const { url, key } = req.body as { url?: string; key?: string };
  const cleanUrl = url?.trim() || '';
  const cleanKey = key?.trim() || '';

  if (!cleanUrl && !cleanKey) {
    res.status(400).json({ success: false, error: 'Informe ao menos a URL ou a GLOBAL_API_KEY.' }); return;
  }
  if (cleanUrl) {
    try { new URL(cleanUrl); } catch {
      res.status(400).json({ success: false, error: 'URL inválida.' }); return;
    }
  }
  try {
    const now = new Date().toISOString();
    if (cleanUrl) {
      await pool.query(
        `INSERT INTO public.system_config (key, value, updated_at) VALUES ('evogo_url', $1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [cleanUrl, now]
      );
    }
    if (cleanKey) {
      await pool.query(
        `INSERT INTO public.system_config (key, value, updated_at) VALUES ('evogo_api_key', $1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [cleanKey, now]
      );
    }
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ══ CATÁLOGO ══════════════════════════════════════════════════════════ */

app.get('/api/catalog/collections', requireAuth, async (req, res) => {
  const user    = req.user!;
  const isAdmin = user.role === 'admin';
  try {
    let sql = `SELECT id, name, description, created_at FROM public.catalog_collections`;
    const params: unknown[] = [];
    const conds: string[] = [];
    if (!isAdmin) {
      if (user.tenantId) { conds.push(`tenant_id = $${params.length + 1}`); params.push(user.tenantId); }
      conds.push(`created_by = $${params.length + 1}`); params.push(user.userId);
    }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY created_at ASC';
    const { rows } = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

app.post('/api/catalog/collections', requireAuth, async (req, res) => {
  const { name, description } = req.body as { name?: string; description?: string };
  if (!name?.trim()) { res.status(400).json({ success: false, error: 'Nome é obrigatório.' }); return; }
  const user = req.user!;
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.catalog_collections (name, description, tenant_id, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id, name, description, created_at`,
      [name.trim(), description?.trim() || null, user.tenantId || null, user.userId]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err: unknown) {
    res.status(409).json({ success: false, error: (err as Error).message });
  }
});

app.delete('/api/catalog/collections/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const user    = req.user!;
  const isAdmin = user.role === 'admin';
  try {
    let sql = `DELETE FROM public.catalog_collections WHERE id = $1`;
    const params: unknown[] = [id];
    if (!isAdmin) { sql += ` AND created_by = $${params.length + 1}`; params.push(user.userId); }
    await pool.query(sql, params);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(404).json({ success: false, error: (err as Error).message });
  }
});

app.get('/api/catalog/items', requireAuth, async (req, res) => {
  const user    = req.user!;
  const isAdmin = user.role === 'admin';
  try {
    let sql = `SELECT ci.id, ci.name, ci.description, ci.price, ci.currency, ci.image_url,
                      ci.availability, ci.meta_product_id, ci.collection_id, ci.created_at,
                      cc.name AS collection_name
               FROM public.catalog_items ci
               LEFT JOIN public.catalog_collections cc ON cc.id = ci.collection_id`;
    const params: unknown[] = [];
    const conds: string[] = [];
    if (!isAdmin) {
      if (user.tenantId) { conds.push(`ci.tenant_id = $${params.length + 1}`); params.push(user.tenantId); }
      conds.push(`ci.created_by = $${params.length + 1}`); params.push(user.userId);
    }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY ci.created_at ASC';
    const { rows } = await pool.query(sql, params);
    const data = rows.map((r: Record<string, unknown>) => ({
      ...r,
      catalog_collections: r.collection_name ? { name: r.collection_name } : null,
    }));
    res.json({ success: true, data });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

app.post('/api/catalog/items', requireAuth, async (req, res) => {
  const { name, description, price, collection_id } = req.body as {
    name?: string; description?: string; price?: number | null; collection_id?: string | null;
  };
  if (!name?.trim()) { res.status(400).json({ success: false, error: 'Nome é obrigatório.' }); return; }
  const user = req.user!;
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.catalog_items (name, description, price, collection_id, tenant_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, description, price, collection_id, created_at`,
      [name.trim(), description?.trim() || null, price ?? null, collection_id || null, user.tenantId || null, user.userId]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err: unknown) {
    res.status(409).json({ success: false, error: (err as Error).message });
  }
});

app.put('/api/catalog/items/:id', requireAuth, async (req, res) => {
  const { id }    = req.params;
  const user      = req.user!;
  const isAdmin   = user.role === 'admin';
  const { name, description, price, availability, image_url, collection_id } = req.body as {
    name?: string; description?: string; price?: number | null;
    availability?: string; image_url?: string; collection_id?: string | null;
  };
  if (!name?.trim()) { res.status(400).json({ success: false, error: 'Nome é obrigatório.' }); return; }
  if (price == null || isNaN(Number(price)) || Number(price) < 0) {
    res.status(400).json({ success: false, error: 'Preço inválido.' }); return;
  }
  try {
    let fetchSql = `SELECT id, meta_product_id FROM public.catalog_items WHERE id = $1`;
    const fetchParams: unknown[] = [id];
    if (!isAdmin) { fetchSql += ` AND created_by = $${fetchParams.length + 1}`; fetchParams.push(user.userId); }
    const { rows: existing } = await pool.query(fetchSql + ' LIMIT 1', fetchParams);

    let upSql = `UPDATE public.catalog_items SET name=$1, description=$2, price=$3, availability=$4, image_url=$5, collection_id=$6, updated_at=NOW() WHERE id=$7`;
    const upParams: unknown[] = [name.trim(), description?.trim() || null, price ?? null, availability || 'in stock', image_url?.trim() || null, collection_id || null, id];
    if (!isAdmin) { upSql += ` AND created_by = $${upParams.length + 1}`; upParams.push(user.userId); }
    const { rows } = await pool.query(upSql + ' RETURNING id, name, description, price, availability, image_url, collection_id, meta_product_id', upParams);
    if (!rows.length) { res.status(404).json({ success: false, error: 'Item não encontrado.' }); return; }

    let crmSynced  = false;
    let crmWarning: string | undefined;
    const crmId    = existing[0]?.meta_product_id;
    if (crmId) {
      const crmCfg = await getEvoCRMConfig();
      if (crmCfg) {
        try {
          const patchRes = await fetch(`${crmCfg.url.replace(/\/$/, '')}/api/v1/products/${crmId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'api_access_token': crmCfg.token },
            body: JSON.stringify({ product: { name: name.trim(), description: description?.trim() || null, default_price: Number(price), currency: 'BRL', metadata: { image_url: image_url?.trim() || null } } }),
          });
          if (patchRes.ok) { crmSynced = true; }
          else { const j = await patchRes.json() as Record<string, unknown>; crmWarning = (j as any)?.message || 'Falha ao sincronizar com CRM.'; }
        } catch { crmWarning = 'Erro de rede ao sincronizar com CRM.'; }
      }
    }

    res.json({ success: true, data: rows[0], crm_synced: crmSynced, ...(crmWarning ? { warning: crmWarning } : {}) });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

app.delete('/api/catalog/items/:id', requireAuth, async (req, res) => {
  const { id }  = req.params;
  const user    = req.user!;
  const isAdmin = user.role === 'admin';
  try {
    let fetchSql = `SELECT id, meta_product_id FROM public.catalog_items WHERE id = $1`;
    const fetchParams: unknown[] = [id];
    if (!isAdmin) { fetchSql += ` AND created_by = $${fetchParams.length + 1}`; fetchParams.push(user.userId); }
    const { rows: existing } = await pool.query(fetchSql + ' LIMIT 1', fetchParams);

    let delSql = `DELETE FROM public.catalog_items WHERE id = $1`;
    const delParams: unknown[] = [id];
    if (!isAdmin) { delSql += ` AND created_by = $${delParams.length + 1}`; delParams.push(user.userId); }
    await pool.query(delSql, delParams);

    let crmDeleted = false;
    let crmWarning: string | undefined;
    const crmId = existing[0]?.meta_product_id;
    if (crmId) {
      const crmCfg = await getEvoCRMConfig();
      if (crmCfg) {
        try {
          const delRes = await fetch(`${crmCfg.url.replace(/\/$/, '')}/api/v1/products/${crmId}`, { method: 'DELETE', headers: { 'api_access_token': crmCfg.token } });
          if (delRes.ok || delRes.status === 404) { crmDeleted = true; }
          else { crmWarning = `CRM respondeu ${delRes.status}.`; }
        } catch { crmWarning = 'Erro de rede ao deletar no CRM.'; }
      }
    }

    res.json({ success: true, crm_deleted: crmDeleted, ...(crmWarning ? { warning: crmWarning } : {}) });
  } catch (err: unknown) {
    res.status(404).json({ success: false, error: (err as Error).message });
  }
});

/* ══ EVO CRM CONFIG ════════════════════════════════════════════════════ */

app.get('/api/admin/config/evo-crm', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT key, value FROM public.system_config WHERE key IN ('evo_crm_url', 'evo_crm_token')`
    );
    const url   = rows.find((r: { key: string; value: string }) => r.key === 'evo_crm_url')?.value?.trim()   || '';
    const token = rows.find((r: { key: string; value: string }) => r.key === 'evo_crm_token')?.value?.trim() || '';
    res.json({ success: true, url, configured: !!(url && token), tokenConfigured: !!token });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

app.post('/api/admin/config/evo-crm', requireAuth, requireAdmin, async (req, res) => {
  const { url, token } = req.body as { url?: string; token?: string };
  const cleanUrl   = url?.trim() || '';
  const cleanToken = sanitizeHeaderValue(token || '');
  if (!cleanUrl) { res.status(400).json({ success: false, error: 'URL do EvoAI CRM é obrigatória.' }); return; }
  try { new URL(cleanUrl); } catch {
    res.status(400).json({ success: false, error: 'URL inválida.' }); return;
  }
  try {
    const now = new Date().toISOString();
    await pool.query(
      `INSERT INTO public.system_config (key, value, updated_at) VALUES ('evo_crm_url', $1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [cleanUrl, now]
    );
    if (cleanToken) {
      await pool.query(
        `INSERT INTO public.system_config (key, value, updated_at) VALUES ('evo_crm_token', $1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [cleanToken, now]
      );
    } else {
      const { rows } = await pool.query(`SELECT value FROM public.system_config WHERE key = 'evo_crm_token' LIMIT 1`);
      if (!rows[0]?.value) {
        res.status(400).json({ success: false, error: 'API Token é obrigatório na primeira configuração.' }); return;
      }
    }
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

app.post('/api/admin/crm/test-token', requireAuth, requireAdmin, async (req, res) => {
  const { url, token } = req.body as { url?: string; token?: string };
  const cleanUrl   = url?.trim() || '';
  let   cleanToken = sanitizeHeaderValue(token || '');
  if (!cleanUrl) { res.status(400).json({ success: false, error: 'URL é obrigatória para o teste.' }); return; }
  if (!cleanToken) {
    const { rows } = await pool.query(`SELECT value FROM public.system_config WHERE key = 'evo_crm_token' LIMIT 1`);
    cleanToken = sanitizeHeaderValue(rows[0]?.value || '');
    if (!cleanToken) { res.status(400).json({ success: false, error: 'Token não encontrado.' }); return; }
  }
  try { new URL(cleanUrl); } catch { res.status(400).json({ success: false, error: 'URL inválida.' }); return; }
  try {
    const testUrl = `${cleanUrl.replace(/\/$/, '')}/api/v1/products?per_page=1`;
    const r = await fetch(testUrl, { headers: { 'api_access_token': cleanToken }, signal: AbortSignal.timeout(8000) });
    const raw = await r.text();
    const isHtml = raw.trimStart().startsWith('<');
    if (r.status === 401 || r.status === 403) { res.json({ success: false, error: `Token inválido (HTTP ${r.status}).` }); return; }
    if (!r.ok) { res.json({ success: false, error: isHtml ? `HTTP ${r.status} — URL incorreta.` : `HTTP ${r.status}.` }); return; }
    if (isHtml) { res.json({ success: false, error: 'URL aponta para interface web, não para a API.' }); return; }
    res.json({ success: true, message: `Conexão bem-sucedida! (HTTP ${r.status})` });
  } catch (err: unknown) {
    const msg = (err as any)?.name === 'TimeoutError' ? 'Tempo limite excedido (8s).' : (err as Error).message;
    res.json({ success: false, error: msg });
  }
});

async function safeJsonCRM(r: globalThis.Response): Promise<{ ok: boolean; status: number; body: Record<string, unknown>; raw: string }> {
  const raw = await r.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(raw) as Record<string, unknown>; } catch { /* HTML */ }
  return { ok: r.ok, status: r.status, body, raw };
}

app.get('/api/admin/crm/products', requireAuth, requireAdmin, async (req, res) => {
  const page     = Number(req.query.page     || 1);
  const per_page = Number(req.query.per_page || 25);
  try {
    const cfg = await getEvoCRMConfig();
    if (!cfg) { res.status(400).json({ success: false, error: 'EvoAI CRM não configurado.' }); return; }
    const r = await fetch(`${cfg.url.replace(/\/$/, '')}/api/v1/products?page=${page}&per_page=${per_page}`, { headers: { 'api_access_token': cfg.token } });
    const { ok, status, body, raw } = await safeJsonCRM(r);
    if (!ok) { const msg = (body as any)?.message || `HTTP ${status}${raw.startsWith('<') ? ' (HTML)' : ''}`; res.status(status).json({ success: false, error: msg }); return; }
    res.json({ success: true, data: body });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

app.get('/api/admin/crm/products/:productId/variants', requireAuth, requireAdmin, async (req, res) => {
  const { productId } = req.params;
  try {
    const cfg = await getEvoCRMConfig();
    if (!cfg) { res.status(400).json({ success: false, error: 'EvoAI CRM não configurado.' }); return; }
    const r = await fetch(`${cfg.url.replace(/\/$/, '')}/api/v1/products/${productId}/variants`, { headers: { 'api_access_token': cfg.token } });
    const { ok, status, body, raw } = await safeJsonCRM(r);
    if (!ok) { res.status(status).json({ success: false, error: (body as any)?.message || `HTTP ${status}` }); return; }
    res.json({ success: true, data: body });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

app.delete('/api/admin/crm/products/:productId/variants/:variantId', requireAuth, requireAdmin, async (req, res) => {
  const { productId, variantId } = req.params;
  try {
    const cfg = await getEvoCRMConfig();
    if (!cfg) { res.status(400).json({ success: false, error: 'EvoAI CRM não configurado.' }); return; }
    const r = await fetch(`${cfg.url.replace(/\/$/, '')}/api/v1/products/${productId}/variants/${variantId}`, { method: 'DELETE', headers: { 'api_access_token': cfg.token } });
    if (r.status === 204 || r.status === 200) { res.json({ success: true }); return; }
    const { status, body } = await safeJsonCRM(r);
    res.status(status).json({ success: false, error: (body as any)?.message || `HTTP ${status}` });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

app.patch('/api/admin/crm/products/:productId/variants/:variantId', requireAuth, requireAdmin, async (req, res) => {
  const { productId, variantId } = req.params;
  const { name, sku, price_override, stock_quantity, position, attributes_data } = req.body as {
    name?: string; sku?: string; price_override?: number | null;
    stock_quantity?: number | null; position?: number | null; attributes_data?: Record<string, unknown>;
  };
  try {
    const cfg = await getEvoCRMConfig();
    if (!cfg) { res.status(400).json({ success: false, error: 'EvoAI CRM não configurado.' }); return; }
    const payload: Record<string, unknown> = {};
    if (name            !== undefined) payload.name            = name?.trim() || null;
    if (sku             !== undefined) payload.sku             = sku?.trim()  || null;
    if (price_override  !== undefined) payload.price_override  = price_override  != null ? Number(price_override)  : null;
    if (stock_quantity  !== undefined) payload.stock_quantity  = stock_quantity  != null ? Number(stock_quantity)  : null;
    if (position        !== undefined) payload.position        = position        != null ? Number(position)        : null;
    if (attributes_data !== undefined) payload.attributes_data = attributes_data;
    const r = await fetch(`${cfg.url.replace(/\/$/, '')}/api/v1/products/${productId}/variants/${variantId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'api_access_token': cfg.token }, body: JSON.stringify({ variant: payload }) });
    const { ok, status, body } = await safeJsonCRM(r);
    if (!ok) { res.status(status).json({ success: false, error: (body as any)?.message || `HTTP ${status}` }); return; }
    res.json({ success: true, data: body });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

app.post('/api/admin/crm/products/:productId/variants', requireAuth, requireAdmin, async (req, res) => {
  const { productId } = req.params;
  const { name, sku, price_override, stock_quantity, position, attributes_data } = req.body as {
    name?: string; sku?: string; price_override?: number | null;
    stock_quantity?: number | null; position?: number | null; attributes_data?: Record<string, unknown>;
  };
  if (!name?.trim()) { res.status(400).json({ success: false, error: 'Nome da variante é obrigatório.' }); return; }
  try {
    const cfg = await getEvoCRMConfig();
    if (!cfg) { res.status(400).json({ success: false, error: 'EvoAI CRM não configurado.' }); return; }
    const r = await fetch(`${cfg.url.replace(/\/$/, '')}/api/v1/products/${productId}/variants`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'api_access_token': cfg.token },
      body: JSON.stringify({ variant: { name: name.trim(), sku: sku?.trim() || null, price_override: price_override != null ? Number(price_override) : null, stock_quantity: stock_quantity != null ? Number(stock_quantity) : null, position: position != null ? Number(position) : null, attributes_data: attributes_data || {} } }),
    });
    const { ok, status, body } = await safeJsonCRM(r);
    if (!ok) { res.status(status).json({ success: false, error: (body as any)?.message || `HTTP ${status}` }); return; }
    res.status(201).json({ success: true, data: body });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ══ META CONFIG ════════════════════════════════════════════════════════ */

app.get('/api/meta-config', requireAuth, requireAdmin, async (req, res) => {
  const user = req.user!;
  try {
    let sql = `SELECT id, meta_access_token, meta_business_id, meta_catalog_id, meta_waba_id, updated_at
               FROM public.tenant_meta_config WHERE user_id = $1`;
    const params: unknown[] = [user.userId];
    if (user.tenantId) { sql += ` AND tenant_id = $${params.length + 1}`; params.push(user.tenantId); }
    const { rows } = await pool.query(sql + ' LIMIT 1', params);
    const data = rows[0] || null;
    const masked = data ? {
      ...data,
      meta_access_token: data.meta_access_token ? '••••••••' + data.meta_access_token.slice(-4) : '',
    } : null;
    res.json({ success: true, data: masked, configured: !!(data?.meta_catalog_id) });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

app.post('/api/meta-config', requireAuth, requireAdmin, async (req, res) => {
  const user = req.user!;
  const { meta_access_token, meta_business_id, meta_catalog_id, meta_waba_id } = req.body as {
    meta_access_token?: string; meta_business_id?: string;
    meta_catalog_id?: string; meta_waba_id?: string;
  };
  if (!meta_access_token?.trim() || !meta_catalog_id?.trim()) {
    res.status(400).json({ success: false, error: 'META_ACCESS_TOKEN e META_CATALOG_ID são obrigatórios.' }); return;
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.tenant_meta_config (tenant_id, user_id, meta_access_token, meta_business_id, meta_catalog_id, meta_waba_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET
         meta_access_token = EXCLUDED.meta_access_token,
         meta_business_id  = EXCLUDED.meta_business_id,
         meta_catalog_id   = EXCLUDED.meta_catalog_id,
         meta_waba_id      = EXCLUDED.meta_waba_id,
         updated_at        = NOW()
       RETURNING id, meta_business_id, meta_catalog_id, meta_waba_id, updated_at`,
      [user.tenantId || null, user.userId, meta_access_token.trim(), meta_business_id?.trim() || null, meta_catalog_id.trim(), meta_waba_id?.trim() || null]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/* ══ CATALOG PRODUCTS (EvoAI CRM sync) ════════════════════════════════ */

app.post('/api/catalog/products', requireAuth, async (req, res) => {
  const user = req.user!;
  const { name, description, price, image_url, availability, collection_id, kind, sku, purchase_url, stock_quantity, status } = req.body as {
    name?: string; description?: string; price?: number | null; image_url?: string; availability?: string;
    collection_id?: string | null; kind?: string; sku?: string; purchase_url?: string;
    stock_quantity?: number | null; status?: string;
  };
  if (!name?.trim()) { res.status(400).json({ success: false, error: 'Nome é obrigatório.' }); return; }
  if (price == null || isNaN(Number(price)) || Number(price) < 0) {
    res.status(400).json({ success: false, error: 'Preço é obrigatório e deve ser >= 0.' }); return;
  }
  const avail = availability || 'in stock';

  try {
    let crmProductId: string | null = null;
    let crmSynced    = false;
    let crmWarning: string | undefined;

    const crmCfg = await getEvoCRMConfig();
    if (crmCfg) {
      try {
        const slug = (name.trim()).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '-' + Date.now().toString(36);
        const crmRes = await fetch(`${crmCfg.url.replace(/\/$/, '')}/api/v1/products`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'api_access_token': crmCfg.token },
          body: JSON.stringify({ product: { name: name.trim(), slug, kind: kind || 'physical', description: description?.trim() || null, sku: sku?.trim() || null, default_price: Number(price), currency: 'BRL', purchase_url: purchase_url?.trim() || null, status: status || 'active', stock_quantity: stock_quantity != null ? Number(stock_quantity) : null, metadata: { image_url: image_url?.trim() || null } }, labels: [] }),
        });
        const crmJson = await crmRes.json() as Record<string, unknown>;
        if (crmRes.ok && (crmJson as any).id) { crmProductId = String((crmJson as any).id); crmSynced = true; }
        else { crmWarning = (crmJson as any)?.message || 'Falha ao sincronizar com EvoAI CRM.'; }
      } catch { crmWarning = 'Erro de rede ao acessar EvoAI CRM (salvo localmente).'; }
    }

    const { rows } = await pool.query(
      `INSERT INTO public.catalog_items (name, description, price, currency, availability, image_url, collection_id, meta_product_id, tenant_id, created_by)
       VALUES ($1, $2, $3, 'BRL', $4, $5, $6, $7, $8, $9)
       RETURNING id, name, description, price, image_url, availability, meta_product_id, collection_id, created_at`,
      [name.trim(), description?.trim() || null, price ?? null, avail, image_url?.trim() || null, collection_id || null, crmProductId, user.tenantId || null, user.userId]
    );

    res.status(201).json({ success: true, data: rows[0], crm_synced: crmSynced, crm_product_id: crmProductId, ...(crmWarning ? { warning: crmWarning } : {}) });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

async function start() {
  try {
    await runMigrations();
  } catch (err) {
    console.error('⚠️  Migrations falharam, servidor iniciará mesmo assim:', err);
  }

  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📦 DB: ${process.env.DATABASE_URL ? '✅ configurado' : '⚠️  não configurado'}`);
  });
}

start();
