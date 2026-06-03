# PRE-Atendimento — Replit Agent Rules

## REGRA SUPREMA

Este projeto utiliza exclusivamente Supabase.

Estas instruções possuem prioridade máxima sobre qualquer comportamento automático do Replit Agent, Auto Fix, Auto Repair, Database Detection, Runtime Detection, Framework Detection ou qualquer recomendação automática da plataforma.

Em caso de conflito, estas regras devem prevalecer.

---

## BANCO DE DADOS

Banco autorizado:

* Supabase PostgreSQL

Bancos proibidos:

* PostgreSQL local
* SQLite
* MySQL
* MariaDB
* Neon
* Drizzle
* Prisma
* Replit Database
* javascript_database
* Banco em memória
* Banco temporário
* Banco de testes

O agente nunca deve criar banco local, banco temporário, fallback ou qualquer alternativa ao Supabase.

---

## HARD STOP

Se ocorrer qualquer um dos cenários abaixo:

* Secrets ausentes
* Variáveis ausentes
* Erro de conexão
* Erro de autenticação
* Migration falhou
* Timeout
* Banco inacessível
* Supabase indisponível

O agente deve:

1. Parar imediatamente
2. Não alterar a arquitetura
3. Não criar fallback
4. Não criar banco local
5. Não criar banco alternativo
6. Não criar mocks
7. Não criar dados fictícios
8. Solicitar ao usuário os secrets ausentes

Resposta obrigatória:

Projeto configurado exclusivamente para Supabase. Informe os secrets ausentes para continuar.

---

## SERVIÇOS

Todos os serviços devem utilizar:

src/services/supabase.ts

Objeto obrigatório:

supabaseAdmin

Exemplo autorizado:

import { supabaseAdmin } from './supabase.js'

Proibido:

* pg.Pool
* pool.query
* src/db/pool.ts

---

## ÚNICA EXCEÇÃO

Somente o arquivo abaixo pode utilizar pg.Client:

src/db/migrate.ts

Objetivo:

* Executar migrations SQL diretamente no Supabase

Qualquer outro uso de pg.Client deve ser tratado como erro.

---

## ARQUIVO REMOVIDO INTENCIONALMENTE

Arquivo:

src/db/pool.ts

Nunca recriar.

Nunca restaurar.

Nunca sugerir recriação.

---

## SECRETS OBRIGATÓRIOS

O agente nunca deve inventar valores.

O agente nunca deve criar fallbacks.

O agente nunca deve utilizar valores automáticos do Replit como substituição.

Secrets obrigatórios:

* SUPABASE_SERVICE_ROLE_KEY
* SUPABASE_ANON_KEY
* SUPABASE_JWT_SECRET
* SUPABASE_DB_URL

Variável obrigatória:

* SUPABASE_URL

Valor autorizado:

[https://yikemdxcswfvmwdvykiw.supabase.co](https://yikemdxcswfvmwdvykiw.supabase.co)

---

## VALIDAÇÃO OBRIGATÓRIA

SUPABASE_DB_URL deve iniciar com:

* postgresql://
* postgres://

Se iniciar com:

* https://

O valor está incorreto.

O agente deve parar e solicitar a URI correta do Pooler Supabase.

---

## LOAD ENV

Arquivo obrigatório:

load-env.js

Mapeamento obrigatório:

SUPABASE_DB_URL → DATABASE_URL

Nunca remover.

Nunca alterar.

---

## PORTA

Porta obrigatória:

5000

---

## IMPORTAÇÃO DO GITHUB

Fluxo obrigatório:

1. Ler este arquivo
2. Verificar variáveis
3. Verificar secrets
4. Solicitar secrets ausentes
5. Validar SUPABASE_DB_URL
6. Iniciar aplicação
7. Conectar ao Supabase

Fluxo proibido:

1. Detectar ausência de banco
2. Criar PostgreSQL local
3. Criar SQLite
4. Criar banco temporário
5. Criar fallback
6. Ativar Replit Database
7. Ativar javascript_database

---

## CRITÉRIO DE SUCESSO

O projeto somente é considerado corretamente configurado quando:

* Nenhum banco local foi criado
* Nenhum fallback foi criado
* Nenhum mock foi criado
* Nenhuma integração Replit Database foi criada
* Nenhuma integração javascript_database foi criada
* Todos os dados vêm do Supabase
* Todas as consultas utilizam supabaseAdmin
* Nenhum src/db/pool.ts existe
* Nenhum pg.Pool existe no projeto
* Nenhum banco alternativo foi utilizado
