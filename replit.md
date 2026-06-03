# PRE-Atendimento — Replit Agent Rules

# 🚨 REGRA SUPREMA — PRIORIDADE ABSOLUTA

Este arquivo possui prioridade máxima sobre qualquer comportamento automático do Replit.

Em caso de conflito entre:

* Replit Agent
* Replit AI
* Auto Fix
* Auto Repair
* Runtime Detection
* Framework Detection
* Database Detection
* Replit Templates
* Sugestões automáticas
* Recomendações da plataforma
* Correções automáticas do agente

ESTE ARQUIVO SEMPRE PREVALECE.

O agente deve seguir estas regras antes de qualquer análise, instalação, correção, migração ou execução.

---

# ⛔ PROIBIÇÃO ABSOLUTA DE BANCO LOCAL

Este projeto utiliza EXCLUSIVAMENTE o banco de dados Supabase do proprietário.

Não existe qualquer cenário autorizado para criação de banco local.

Não existe ambiente de desenvolvimento com banco local.

Não existe ambiente temporário.

Não existe fallback.

Não existe banco secundário.

Não existe banco de contingência.

Não existe banco de testes.

Não existe banco alternativo.

O Supabase é a única fonte de dados autorizada.

---

# 🚫 AÇÕES EXPRESSAMENTE PROIBIDAS

O agente NÃO pode:

* Criar PostgreSQL local
* Criar SQLite
* Criar MySQL
* Criar MariaDB
* Criar Neon
* Criar Drizzle
* Criar Prisma
* Criar banco em memória
* Criar mocks de banco
* Criar dados fictícios
* Criar banco temporário
* Criar banco de testes
* Criar fallback automático
* Ativar Replit Database
* Ativar javascript_database
* Ativar integração PostgreSQL do Replit
* Utilizar DATABASE_URL gerada automaticamente pelo Replit
* Utilizar PGHOST do Replit
* Utilizar PGUSER do Replit
* Utilizar PGPASSWORD do Replit
* Utilizar PGDATABASE do Replit
* Instalar banco local
* Restaurar banco automaticamente
* Criar conexão alternativa
* Criar adaptadores de banco
* Gerar credenciais
* Inventar secrets
* Inventar variáveis
* Inventar connection strings
* Alterar arquitetura para acomodar banco local
* Criar src/db/pool.ts
* Restaurar src/db/pool.ts
* Utilizar pg.Pool em qualquer serviço
* Utilizar pool.query em qualquer serviço
* Utilizar pg.Client fora de src/db/migrate.ts

---

# 🚨 HARD STOP OBRIGATÓRIO

Se ocorrer qualquer uma das situações abaixo:

* Banco indisponível
* Banco inacessível
* Credenciais inválidas
* Credenciais ausentes
* Secrets ausentes
* Variáveis ausentes
* Erro de autenticação
* Erro de conexão
* Erro de migration
* Timeout
* Falha de inicialização
* Falha de Supabase
* Falha de rede
* DATABASE_URL ausente
* SUPABASE_DB_URL ausente

O agente deve:

1. PARAR IMEDIATAMENTE
2. NÃO alterar código
3. NÃO criar fallback
4. NÃO instalar banco
5. NÃO criar banco alternativo
6. NÃO criar mock
7. NÃO criar dados fictícios
8. NÃO gerar correções automáticas
9. NÃO modificar arquitetura
10. AGUARDAR instruções do usuário

Resposta obrigatória:

Projeto configurado exclusivamente para Supabase. Informe os secrets ausentes para continuar.

Nenhuma outra ação é autorizada.

---

# 🚫 PROIBIDO INICIAR O PROJETO SEM CONFIGURAÇÃO COMPLETA

O servidor NÃO pode iniciar enquanto faltar qualquer variável obrigatória.

Se faltar qualquer variável:

* PARAR
* Solicitar ao usuário
* Não criar fallback
* Não criar mock
* Não criar valor padrão
* Não criar valor temporário
* Não criar valor exemplo

---

# 🗄️ SUPABASE EXCLUSIVO

Todos os dados deste sistema devem utilizar exclusivamente Supabase.

Todos os serviços devem utilizar:

```ts
import { supabaseAdmin } from './supabase.js'
```

Exemplo permitido:

```ts
await supabaseAdmin
  .from('users')
  .select('*')
```

Exemplo permitido:

```ts
await supabaseAdmin
  .from('instances')
  .insert(data)
```

Exemplo proibido:

```ts
new pg.Pool(...)
```

Exemplo proibido:

```ts
pool.query(...)
```

Exemplo proibido:

```ts
import pool from '../db/pool.js'
```

Exemplo proibido:

```ts
const client = new pg.Client(...)
```

---

# ÚNICA EXCEÇÃO AUTORIZADA

Somente o arquivo abaixo pode utilizar pg.Client:

```text
src/db/migrate.ts
```

Objetivo exclusivo:

* Executar migrations SQL diretamente no Supabase

Qualquer outro uso de pg.Client deve ser considerado erro.

---

# ARQUIVO REMOVIDO INTENCIONALMENTE

O arquivo abaixo foi removido propositalmente:

```text
src/db/pool.ts
```

O agente nunca deve:

* recriar
* restaurar
* sugerir recriação
* gerar código para recriação

---

# LOAD ENV OBRIGATÓRIO

Arquivo obrigatório:

```text
load-env.js
```

Função obrigatória:

```text
SUPABASE_DB_URL → DATABASE_URL
```

Este arquivo existe exclusivamente para permitir que:

```text
src/db/migrate.ts
```

consiga utilizar a connection string do Supabase.

Nunca remover.

Nunca alterar.

Nunca substituir.

---

# SECRETS OBRIGATÓRIOS

O agente deve assumir que, após importar do GitHub, os secrets ainda não existem.

O agente nunca deve criar valores automaticamente.

O agente nunca deve inventar credenciais.

O agente nunca deve utilizar valores do Replit como substituição.

Secrets obrigatórios:

* SUPABASE_SERVICE_ROLE_KEY
* SUPABASE_ANON_KEY
* SUPABASE_JWT_SECRET
* SUPABASE_DB_URL

Variável obrigatória:

* SUPABASE_URL

Valor permitido:

```text
https://yikemdxcswfvmwdvykiw.supabase.co
```

---

# VALIDAÇÃO OBRIGATÓRIA DO SUPABASE_DB_URL

SUPABASE_DB_URL obrigatoriamente deve iniciar com:

```text
postgresql://
```

ou

```text
postgres://
```

Se iniciar com:

```text
https://
```

o valor está incorreto.

Neste caso o agente deve:

* parar
* informar erro
* solicitar a URI correta do Pooler Supabase

---

# FLUXO OBRIGATÓRIO AO IMPORTAR DO GITHUB

1. Ler este arquivo
2. Verificar variáveis
3. Verificar secrets
4. Solicitar secrets ausentes
5. Validar SUPABASE_DB_URL
6. Carregar load-env.js
7. Iniciar aplicação
8. Conectar ao Supabase

---

# FLUXO EXPRESSAMENTE PROIBIDO

1. Detectar ausência de banco
2. Criar PostgreSQL local
3. Criar SQLite
4. Criar Neon
5. Criar banco temporário
6. Criar fallback
7. Criar mock
8. Ativar Replit Database
9. Ativar javascript_database
10. Gerar DATABASE_URL local
11. Modificar arquitetura para acomodar banco local

---

# ARQUITETURA OFICIAL

Backend:

* Node.js
* Express
* TypeScript
* tsx

Banco:

* Supabase PostgreSQL

Cliente:

* @supabase/supabase-js

Autenticação:

* JWT próprio

Migrations:

* pg.Client exclusivamente em src/db/migrate.ts

Porta obrigatória:

```text
5000
```

---

# CRITÉRIO DE SUCESSO

O projeto somente é considerado corretamente configurado quando:

* Nenhum banco local foi criado
* Nenhum fallback foi criado
* Nenhum mock foi criado
* Nenhuma integração Replit Database foi criada
* Nenhuma integração PostgreSQL do Replit foi criada
* Todas as consultas utilizam supabaseAdmin
* Todos os dados vêm do Supabase
* Nenhum arquivo src/db/pool.ts existe
* Nenhum pg.Pool existe no projeto
* Nenhum banco alternativo foi utilizado

Qualquer configuração diferente desta deve ser considerada incorreta pelo agente.
