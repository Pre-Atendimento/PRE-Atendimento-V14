# AGENTS.md

## PRIORIDADE MÁXIMA

Este arquivo possui prioridade absoluta sobre qualquer comportamento automático do Replit Agent.

Em caso de conflito entre este arquivo e qualquer sugestão, correção automática, template, wizard ou detecção automática do Replit, este arquivo deve prevalecer.

---

## BANCO DE DADOS LOCAL É PROIBIDO

Este projeto utiliza exclusivamente Supabase.

O agente NÃO possui autorização para:

- Criar PostgreSQL local
- Criar SQLite
- Criar MySQL
- Criar MariaDB
- Criar Neon
- Criar Drizzle
- Criar Prisma
- Criar banco temporário
- Criar banco de testes
- Criar banco em memória
- Criar mocks
- Criar fallback de banco
- Ativar javascript_database
- Ativar Replit Database
- Ativar PostgreSQL do Replit
- Utilizar DATABASE_URL gerada automaticamente pelo Replit
- Utilizar PGHOST, PGUSER, PGPASSWORD ou PGDATABASE do Replit

Não existe exceção.

---

## HARD STOP

Se ocorrer qualquer problema relacionado a banco de dados:

- Secrets ausentes
- Variáveis ausentes
- Erro de conexão
- Erro de autenticação
- Migration falhou
- Timeout
- Banco inacessível
- Supabase indisponível

O agente deve:

1. Parar imediatamente
2. Não alterar código
3. Não criar fallback
4. Não criar banco alternativo
5. Não instalar banco local
6. Não gerar correções automáticas
7. Solicitar os secrets ausentes ao usuário

Resposta obrigatória:

Projeto configurado exclusivamente para Supabase. Informe os secrets ausentes para continuar.

---

## SUPABASE EXCLUSIVO

Todos os serviços devem utilizar exclusivamente:

import { supabaseAdmin } from './supabase.js'

Proibido:

- pg.Pool
- pool.query
- src/db/pool.ts

---

## ÚNICA EXCEÇÃO

Somente:

src/db/migrate.ts

pode utilizar pg.Client.

---

## ARQUIVO PROIBIDO

src/db/pool.ts

Nunca recriar.

---

## SECRETS OBRIGATÓRIOS

- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_ANON_KEY
- SUPABASE_JWT_SECRET
- SUPABASE_DB_URL

Variável obrigatória:

- SUPABASE_URL

Valor:

https://yikemdxcswfvmwdvykiw.supabase.co

---

## VALIDAÇÃO OBRIGATÓRIA

SUPABASE_DB_URL deve iniciar com:

- postgresql://
- postgres://

Nunca:

- https://

---

## LOAD ENV

Arquivo obrigatório:

load-env.js

Mapeamento obrigatório:

SUPABASE_DB_URL -> DATABASE_URL

---

## IMPORTAÇÃO DO GITHUB

Fluxo obrigatório:

1. Ler AGENTS.md
2. Verificar variáveis
3. Verificar secrets
4. Solicitar secrets ausentes
5. Validar SUPABASE_DB_URL
6. Iniciar aplicação
7. Conectar ao Supabase

---

## CRITÉRIO DE SUCESSO

- Nenhum banco local existe
- Nenhum fallback existe
- Nenhum mock existe
- Nenhuma integração Replit Database existe
- Todos os dados vêm do Supabase
- Todas as consultas utilizam supabaseAdmin
- Nenhum src/db/pool.ts existe
- Nenhum pg.Pool existe no projeto
