import pg from 'pg';

const SQL_MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: '001_create_migrations_table',
    sql: `
      CREATE TABLE IF NOT EXISTS public._migrations (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    name: '002_create_instances_table',
    sql: `
      CREATE TABLE IF NOT EXISTS public.instances (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        instance_name TEXT NOT NULL UNIQUE,
        status        TEXT NOT NULL DEFAULT 'creating',
        metadata      JSONB,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_instances_instance_name ON public.instances (instance_name);
      CREATE INDEX IF NOT EXISTS idx_instances_status ON public.instances (status);
    `,
  },
  {
    name: '003_create_updated_at_trigger',
    sql: `
      CREATE OR REPLACE FUNCTION public.set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_instances_updated_at ON public.instances;
      CREATE TRIGGER trg_instances_updated_at
        BEFORE UPDATE ON public.instances
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    `,
  },
  {
    name: '004_create_instance_logs_table',
    sql: `
      CREATE TABLE IF NOT EXISTS public.instance_logs (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        instance_id UUID NOT NULL REFERENCES public.instances (id) ON DELETE CASCADE,
        event       TEXT NOT NULL,
        payload     JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_instance_logs_instance_id ON public.instance_logs (instance_id);
      CREATE INDEX IF NOT EXISTS idx_instance_logs_event ON public.instance_logs (event);
      CREATE INDEX IF NOT EXISTS idx_instance_logs_created_at ON public.instance_logs (created_at DESC);
    `,
  },
  {
    name: '005b_create_users_table',
    sql: `
      CREATE TABLE IF NOT EXISTS public.users (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name          TEXT NOT NULL,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'user',
        active        BOOLEAN NOT NULL DEFAULT true,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (email);
    `,
  },
  {
    name: '006_create_tenants_table',
    sql: `
      CREATE TABLE IF NOT EXISTS public.tenants (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name       TEXT NOT NULL,
        slug       TEXT NOT NULL UNIQUE,
        active     BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_tenants_slug ON public.tenants (slug);

      INSERT INTO public.tenants (name, slug)
      VALUES ('Default', 'default')
      ON CONFLICT (slug) DO NOTHING;
    `,
  },
  {
    name: '007_add_tenant_to_users',
    sql: `
      ALTER TABLE public.users
        ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);

      UPDATE public.users
      SET tenant_id = (SELECT id FROM public.tenants WHERE slug = 'default')
      WHERE tenant_id IS NULL;

      CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON public.users (tenant_id);
    `,
  },
  {
    name: '008_add_tenant_to_instances',
    sql: `
      ALTER TABLE public.instances
        ADD COLUMN IF NOT EXISTS tenant_id  UUID REFERENCES public.tenants(id),
        ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id);

      UPDATE public.instances
      SET tenant_id = (SELECT id FROM public.tenants WHERE slug = 'default')
      WHERE tenant_id IS NULL;

      CREATE INDEX IF NOT EXISTS idx_instances_tenant_id ON public.instances (tenant_id);
      CREATE INDEX IF NOT EXISTS idx_instances_created_by ON public.instances (created_by);
    `,
  },
  {
    name: '010_add_provider_to_instances',
    sql: `
      ALTER TABLE public.instances
        ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'evo-go';

      CREATE INDEX IF NOT EXISTS idx_instances_provider ON public.instances (provider);
    `,
  },
  {
    name: '011_add_max_instances_to_users',
    sql: `
      ALTER TABLE public.users
        ADD COLUMN IF NOT EXISTS max_instances INTEGER DEFAULT NULL;
    `,
  },
  {
    name: '012_enforce_user_instance_limits',
    sql: `
      UPDATE public.users
        SET max_instances = 1
        WHERE max_instances IS NULL AND role = 'user';

      DO $$ BEGIN
        ALTER TABLE public.users
          ADD CONSTRAINT chk_max_instances CHECK (max_instances BETWEEN 1 AND 5);
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `,
  },
  {
    name: '013_create_catalog_collections',
    sql: `
      CREATE TABLE IF NOT EXISTS public.catalog_collections (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        TEXT NOT NULL,
        description TEXT,
        tenant_id   UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
        created_by  UUID REFERENCES public.users(id)   ON DELETE SET NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_catalog_collections_tenant ON public.catalog_collections (tenant_id);
      CREATE INDEX IF NOT EXISTS idx_catalog_collections_created_by ON public.catalog_collections (created_by);
    `,
  },
  {
    name: '014_create_catalog_items',
    sql: `
      CREATE TABLE IF NOT EXISTS public.catalog_items (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name            TEXT NOT NULL,
        description     TEXT,
        price           NUMERIC(10,2),
        currency        TEXT DEFAULT 'BRL',
        availability    TEXT DEFAULT 'in stock',
        image_url       TEXT,
        meta_product_id TEXT,
        collection_id   UUID REFERENCES public.catalog_collections(id) ON DELETE SET NULL,
        tenant_id       UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
        created_by      UUID REFERENCES public.users(id)   ON DELETE SET NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_catalog_items_tenant ON public.catalog_items (tenant_id);
      CREATE INDEX IF NOT EXISTS idx_catalog_items_collection ON public.catalog_items (collection_id);
    `,
  },
  {
    name: '015_create_system_config',
    sql: `
      CREATE TABLE IF NOT EXISTS public.system_config (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    name: '016_create_tenant_meta_config',
    sql: `
      CREATE TABLE IF NOT EXISTS public.tenant_meta_config (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
        user_id            UUID REFERENCES public.users(id)   ON DELETE CASCADE,
        meta_access_token  TEXT,
        meta_business_id   TEXT,
        meta_catalog_id    TEXT,
        meta_waba_id       TEXT,
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (tenant_id, user_id)
      );
    `,
  },
];

export async function runMigrations(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('❌ FATAL: DATABASE_URL é obrigatória para rodar migrations.');
    process.exit(1);
  }

  if (!connectionString.startsWith('postgres://') && !connectionString.startsWith('postgresql://')) {
    throw new Error(
      `DATABASE_URL inválida: deve começar com "postgresql://" (recebido: "${connectionString.substring(0, 30)}...").`
    );
  }

  const client = new pg.Client({
    connectionString,
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    await client.connect();
    console.log('✅ Conectado ao banco de dados');

    await client.query(SQL_MIGRATIONS[0].sql);

    const { rows } = await client.query<{ name: string }>(
      'SELECT name FROM public._migrations'
    );
    const applied = new Set(rows.map((r) => r.name));

    for (const migration of SQL_MIGRATIONS) {
      if (applied.has(migration.name)) {
        console.log(`⏭️  Já aplicada: ${migration.name}`);
        continue;
      }
      console.log(`🔄 Aplicando: ${migration.name}`);
      await client.query(migration.sql);
      await client.query(
        'INSERT INTO public._migrations (name) VALUES ($1) ON CONFLICT DO NOTHING',
        [migration.name]
      );
      console.log(`✅ Concluída: ${migration.name}`);
    }

    console.log('🎉 Todas as migrations aplicadas com sucesso.');
  } catch (err) {
    console.error('❌ Erro nas migrations:', err);
    throw err;
  } finally {
    await client.end();
  }
}
