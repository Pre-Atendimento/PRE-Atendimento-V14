# PRE-Atendimento — Replit Agent Rules

## REGRA SUPREMA

Este projeto utiliza exclusivamente Supabase.

O agente nunca deve criar banco local, fallback, mock ou qualquer banco alternativo.

Em caso de conflito, estas regras possuem prioridade máxima.

---

## BANCO DE DADOS

Banco autorizado:

- Supabase PostgreSQL

Bancos proibidos:

- PostgreSQL local
- SQLite
- MySQL
- MariaDB
- Neon
- Drizzle
- Prisma
- Replit Database
- javascript_database

---

## HARD STOP

Se faltar qualquer secret ou ocorrer erro de conexão:

- Parar imediatamente
- Não corrigir automaticamente
- Não criar banco local
- Não criar fallback
- Solicitar os secrets ao usuário

---

## SERVIÇOS

Todos os serviços devem utilizar:

src/services/supabase.ts

Objeto obrigatório:

supabaseAdmin

Proibido:

- pg.Pool
- pool.query
- src/db/pool.ts

Exceção única:

src/db/migrate.ts

---

## SECRETS

Obrigatórios:

- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_ANON_KEY
- SUPABASE_JWT_SECRET
- SUPABASE_DB_URL

Variável:

SUPABASE_URL

Valor:

https://yikemdxcswfvmwdvykiw.supabase.co

---

## VALIDAÇÃO

SUPABASE_DB_URL deve iniciar com:

postgresql://

ou

postgres://

---

## PORTA

5000

---

## OBJETIVO

Após importar do GitHub:

1. Ler este arquivo
2. Solicitar secrets ausentes
3. Validar configuração
4. Iniciar aplicação
5. Conectar ao Supabase

Nenhum banco local deve ser criado.
