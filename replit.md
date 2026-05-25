# PRE-Atendimento — Replit Agent Rules

---

## 🚨 ATENÇÃO — LEIA ANTES DE QUALQUER AÇÃO

### ❌ PROIBIDO CRIAR BANCO DE DADOS LOCAL NO REPLIT

Este projeto já possui banco de dados próprio no **Supabase**.

O agente **NÃO deve, em nenhuma hipótese:**

- Criar banco PostgreSQL local no Replit
- Ativar integração `javascript_database` ou `postgresql` do Replit
- Usar `DATABASE_URL` gerada automaticamente pelo Replit
- Usar `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` do Replit
- Propor migração de banco para qualquer outro serviço
- Criar fallback automático de banco
- Criar banco SQLite, Neon, Drizzle, Prisma ou qualquer alternativa
- Criar mocks ou dados em memória como substituto ao banco
- Criar ou restaurar `src/db/pool.ts` — este arquivo foi **removido intencionalmente**

**Se o Replit sugerir automaticamente criar um banco local → RECUSAR e usar Supabase.**

---

## 🗄️ BANCO DE DADOS — SUPABASE EXCLUSIVO

Este projeto utiliza **EXCLUSIVAMENTE** o banco de dados hospedado no Supabase do proprietário.

### Regra absoluta de acesso ao banco:

**TODOS os serviços usam `supabaseAdmin` de `src/services/supabase.ts`.**  
Nenhum serviço usa `pg.Pool`, `pg.Client` ou `pool.query` diretamente — exceto `src/db/migrate.ts` (único arquivo autorizado a usar `pg.Client` para rodar SQL raw das migrations).

```
✅ CORRETO:  import { supabaseAdmin } from './supabase.js'
✅ CORRETO:  supabaseAdmin.from('tabela').select(...)
❌ ERRADO:   import pool from '../db/pool.js'
❌ ERRADO:   new pg.Pool({ connectionString: ... })
❌ ERRADO:   pool.query('SELECT ...')
```

O arquivo `load-env.js` na raiz mapeia automaticamente:
```
DATABASE_URL = SUPABASE_DB_URL
```

Este mapeamento existe **apenas** para que `src/db/migrate.ts` consiga usar `pg.Client` com a connection string do Supabase. Nunca remover `load-env.js`.

---

## 🔐 SECRETS — FLUXO OBRIGATÓRIO AO IMPORTAR

Ao importar do GitHub para o Replit, **os secrets não existem ainda**.

**Regra:** Assumir que o usuário irá fornecer os secrets.  
**Nunca** inventar valores, criar fallbacks ou usar variáveis do Replit no lugar.

### Variáveis normais (não secret) — configurar via setEnvVar se ausentes:

| Variável | Valor |
|----------|-------|
| `SUPABASE_URL` | `https://yikemdxcswfvmwdvykiw.supabase.co` |

### Secrets obrigatórios — solicitar ao usuário se ausentes:

| Secret | Onde encontrar no Supabase | Formato esperado |
|--------|---------------------------|-----------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role | `eyJ...` (JWT longo) |
| `SUPABASE_ANON_KEY` | Project Settings → API → anon public | `eyJ...` (JWT longo) |
| `SUPABASE_JWT_SECRET` | Project Settings → API → JWT Settings → JWT Secret | string aleatória longa |
| `SUPABASE_DB_URL` | Project Settings → Database → Connection string → **Pooler** → URI | `postgresql://postgres.xxxx:SENHA@aws-0-xx.pooler.supabase.com:6543/postgres` |

### ⚠️ SUPABASE_DB_URL — formato obrigatório

`SUPABASE_DB_URL` **deve começar com `postgresql://` ou `postgres://`**, nunca com `https://`.  
Se o valor começar com `https://`, está errado — é a URL do Supabase, não a connection string.

Localização correta no painel Supabase:  
`Project Settings → Database → Connection string → Mode: Pooler (porta 6543) → URI`

### Se faltar qualquer variável:
1. PARAR — não iniciar o servidor
2. Mostrar qual variável está faltando e o formato esperado
3. Solicitar ao usuário via secrets do Replit
4. NÃO criar fallback, NÃO inventar valores

---

## 🏗️ ARQUITETURA (NÃO ALTERAR)

```
src/
  server.ts              ← entrada principal (porta 5000) — usa supabaseAdmin
  services/
    supabase.ts          ← cria supabaseAdmin e supabaseClient (MANTER)
    authService.ts       ← auth via supabaseAdmin (login, register, reset)
    instanceService.ts   ← lógica de instâncias WhatsApp via supabaseAdmin
    evolutionGo.ts       ← integração Evolution GO API (sem banco)
  db/
    migrate.ts           ← ÚNICO arquivo que usa pg.Client via DATABASE_URL

public/
  index.html             ← login
  dashboard.html         ← dashboard principal

load-env.js              ← mapeia SUPABASE_DB_URL → DATABASE_URL (NUNCA REMOVER)
tsconfig.json            ← configuração TypeScript (NUNCA REMOVER)
.env.example             ← documentação das variáveis necessárias
```

**Arquivo REMOVIDO intencionalmente:** `src/db/pool.ts` — não recriar.

- Backend: Node.js + Express + TypeScript (`tsx`)
- Banco: Supabase PostgreSQL via `@supabase/supabase-js` (supabaseAdmin)
- Migrations: `pg.Client` conectando via `SUPABASE_DB_URL` (único uso de pg direto)
- Auth: JWT próprio (bcrypt + jsonwebtoken)
- API externa: Evolution GO (URL configurada pelo admin no painel)
- Porta: **5000** (obrigatória)

---

## 🔒 SEGURANÇA — ISOLAMENTO MULTI-TENANT

Duas camadas obrigatórias em todas as queries:
- `tenant_id`
- `created_by`

Regras:
- Usuário comum → apenas seus próprios dados
- Admin → acesso total

---

## 🚨 COMPORTAMENTO DO AGENT

**NÃO pode:**
- Alterar layout ou frontend
- Alterar rotas existentes sem instrução explícita
- Refatorar código sem instrução explícita
- Instalar bibliotecas desnecessárias
- Rodar migrations destrutivas
- Criar banco local de qualquer tipo
- Usar `pg.Pool`, `pg.Client` ou `pool.query` em qualquer serviço (exceto `migrate.ts`)
- Recriar `src/db/pool.ts`

**Se houver erro:**
1. Mostrar o erro completo
2. Indicar qual variável ou secret está faltando e o formato correto
3. Aguardar instrução do usuário — nunca corrigir automaticamente com fallback

---

## 🔁 STATUS DE INSTÂNCIAS

Valores válidos: `creating` | `active` | `connected` | `inactive` | `error`  
Apenas `connected` = instância conectada ao WhatsApp.

---

## 📡 EVOLUTION GO

- `create` → usa `GLOBAL_API_KEY`
- `connect` / `status` / `qr` → usa token da instância
- `delete` → usa UUID da instância
- QR retorna campos `Qrcode` e `Code`

---

## 🎯 RESULTADO ESPERADO AO IMPORTAR DO GITHUB

1. Agente lê este arquivo primeiro
2. Define `SUPABASE_URL` via `setEnvVars` (valor já conhecido)
3. Verifica quais secrets estão ausentes com `viewEnvVars`
4. Solicita secrets faltantes ao usuário com `requestEnvVar` (nunca cria fallback)
5. Valida que `SUPABASE_DB_URL` começa com `postgresql://` ou `postgres://`
6. `load-env.js` mapeia `SUPABASE_DB_URL → DATABASE_URL` automaticamente
7. `pnpm run dev` inicia na porta 5000
8. Supabase conectado — nenhum banco local criado no Replit

## User preferences

- Banco de dados: Supabase exclusivamente — nunca banco local do Replit
- Todos os serviços devem usar `supabaseAdmin` de `src/services/supabase.ts`
- A única exceção autorizada para `pg.Client` é `src/db/migrate.ts`
- `src/db/pool.ts` foi removido e não deve ser recriado
- Secrets: sempre solicitar ao usuário, nunca criar fallback ou valor padrão
- Variáveis obrigatórias: SUPABASE_URL (env var), SUPABASE_DB_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET (secrets)
- SUPABASE_DB_URL deve começar com `postgresql://` — se vier como `https://` está errado
- Se o Replit sugerir banco local automaticamente: recusar e usar Supabase
