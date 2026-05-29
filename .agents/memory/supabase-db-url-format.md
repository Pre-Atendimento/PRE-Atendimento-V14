---
name: SUPABASE_DB_URL format
description: Common misconfiguration where user pastes the Supabase dashboard URL instead of the PostgreSQL pooler connection string.
---

## Rule
`SUPABASE_DB_URL` must start with `postgresql://` or `postgres://`. It is the Pooler connection URI found at:
Supabase → Project Settings → Database → Connection string → **Mode: Pooler (port 6543)** → URI

Format: `postgresql://postgres.xxxx:PASSWORD@aws-0-xx.pooler.supabase.com:6543/postgres`

## Why
Users frequently paste the Supabase dashboard URL (`https://xxxx.supabase.co`) instead of the DB connection string. `pg.Client.connect()` does not fail immediately with an invalid URL — it hangs indefinitely, silently blocking `runMigrations()` and preventing `app.listen()` from ever being called. The server appears to start (process exists) but never opens port 5000.

## How to apply
In `migrate.ts`: validate the format before creating the `pg.Client` — throw immediately if URL doesn't start with `postgres`. Also set `connectionTimeoutMillis: 10000` on the client as a safety net. In `load-env.js`: `DATABASE_URL` is always set from `SUPABASE_DB_URL`, so this validation also protects migrations from the wrong value being mapped.
