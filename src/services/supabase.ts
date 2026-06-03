import pg from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ FATAL: DATABASE_URL é obrigatória. Encerrando aplicação.');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString,
  ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('[db] Pool error:', err);
});

type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
  count?: number | null;
}

interface QueryResultMany<T> {
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
}

function toSnake(obj: Record<string, unknown>): Record<string, unknown> {
  return obj;
}

class QueryBuilder<T extends Record<string, unknown>> {
  private _table: string;
  private _select: string;
  private _filters: { col: string; op: string; val: unknown }[] = [];
  private _inFilters: { col: string; vals: unknown[] }[] = [];
  private _order: { col: string; asc: boolean } | null = null;
  private _limit: number | null = null;
  private _single = false;
  private _maybeSingle = false;
  private _insert: Record<string, unknown> | null = null;
  private _insertMany: Record<string, unknown>[] | null = null;
  private _update: Record<string, unknown> | null = null;
  private _delete = false;
  private _upsert: { data: Record<string, unknown>; onConflict?: string } | null = null;
  private _countMode: 'exact' | null = null;
  private _head = false;
  private _returning: string | null = null;
  private _notEqFilters: { col: string; val: unknown }[] = [];

  constructor(table: string) {
    this._table = table;
    this._select = '*';
  }

  select(cols: string, opts?: { count?: 'exact'; head?: boolean }): this {
    if (opts?.count === 'exact') this._countMode = 'exact';
    if (opts?.head) this._head = true;
    if (!opts?.head) this._select = cols;
    return this;
  }

  eq(col: string, val: unknown): this {
    this._filters.push({ col, op: '=', val });
    return this;
  }

  neq(col: string, val: unknown): this {
    this._notEqFilters.push({ col, val });
    return this;
  }

  in(col: string, vals: unknown[]): this {
    this._inFilters.push({ col, vals });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this._order = { col, asc: opts?.ascending !== false };
    return this;
  }

  limit(n: number): this {
    this._limit = n;
    return this;
  }

  single(): Promise<QueryResult<T>> {
    this._single = true;
    this._limit = 1;
    return this._execute() as Promise<QueryResult<T>>;
  }

  maybeSingle(): Promise<QueryResult<T>> {
    this._maybeSingle = true;
    this._limit = 1;
    return this._execute() as Promise<QueryResult<T>>;
  }

  insert(data: Record<string, unknown> | Record<string, unknown>[]): this {
    if (Array.isArray(data)) {
      this._insertMany = data;
    } else {
      this._insert = data;
    }
    return this;
  }

  update(data: Record<string, unknown>): this {
    this._update = data;
    return this;
  }

  delete(): this {
    this._delete = true;
    return this;
  }

  upsert(data: Record<string, unknown>, opts?: { onConflict?: string }): this {
    this._upsert = { data, onConflict: opts?.onConflict };
    return this;
  }

  then<TResult1 = QueryResultMany<T>>(
    onfulfilled: (value: QueryResultMany<T>) => TResult1,
  ): Promise<TResult1> {
    return this._execute().then(onfulfilled as never) as Promise<TResult1>;
  }

  async _execute(): Promise<QueryResult<T> | QueryResultMany<T>> {
    const client = await pool.connect();
    try {
      if (this._insert !== null) {
        return await this._runInsert(client, this._insert);
      }
      if (this._insertMany !== null) {
        return await this._runInsertMany(client, this._insertMany);
      }
      if (this._upsert !== null) {
        return await this._runUpsert(client, this._upsert);
      }
      if (this._update !== null) {
        return await this._runUpdate(client, this._update);
      }
      if (this._delete) {
        return await this._runDelete(client);
      }
      return await this._runSelect(client);
    } catch (err: unknown) {
      return { data: null, error: { message: (err as Error).message }, count: null };
    } finally {
      client.release();
    }
  }

  private _buildWhere(startIdx = 1): { clause: string; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = startIdx;

    for (const f of this._filters) {
      conditions.push(`"${f.col}" ${f.op} $${idx++}`);
      params.push(f.val);
    }
    for (const f of this._notEqFilters) {
      conditions.push(`"${f.col}" != $${idx++}`);
      params.push(f.val);
    }
    for (const f of this._inFilters) {
      if (!f.vals.length) {
        conditions.push('1=0');
        continue;
      }
      const placeholders = f.vals.map(() => `$${idx++}`).join(', ');
      conditions.push(`"${f.col}" IN (${placeholders})`);
      params.push(...f.vals);
    }

    return {
      clause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
      params,
    };
  }

  private _parseSelectCols(raw: string): string {
    if (raw === '*') return '*';
    const parts = raw.split(',').map(p => p.trim());
    const cols: string[] = [];
    for (const part of parts) {
      const parenIdx = part.indexOf('(');
      if (parenIdx !== -1) {
        continue;
      }
      cols.push(`"${part}"`);
    }
    return cols.length ? cols.join(', ') : '*';
  }

  private async _runSelect(client: pg.PoolClient): Promise<QueryResult<T> | QueryResultMany<T>> {
    const { clause, params } = this._buildWhere(1);

    if (this._countMode === 'exact' && this._head) {
      const sql = `SELECT COUNT(*) FROM "${this._table}" ${clause}`;
      const result = await client.query(sql, params);
      const count = parseInt(result.rows[0]?.count ?? '0', 10);
      return { data: null, error: null, count };
    }

    const selectCols = this._parseSelectCols(this._select);
    let sql = `SELECT ${selectCols} FROM "${this._table}" ${clause}`;

    if (this._order) {
      sql += ` ORDER BY "${this._order.col}" ${this._order.asc ? 'ASC' : 'DESC'}`;
    }
    if (this._limit !== null) {
      sql += ` LIMIT ${this._limit}`;
    }

    const result = await client.query(sql, params);
    const rows = result.rows as T[];

    if (this._select !== '*' && this._select.includes('(')) {
      const enriched = await this._resolveJoins(client, rows);
      if (this._single || this._maybeSingle) {
        const row = enriched[0] ?? null;
        if (this._single && !row) return { data: null, error: { message: 'No rows found' } };
        return { data: row as T, error: null };
      }
      return { data: enriched as T[], error: null, count: this._countMode ? enriched.length : null };
    }

    if (this._single || this._maybeSingle) {
      const row = rows[0] ?? null;
      if (this._single && !row) return { data: null, error: { message: 'No rows found' } };
      return { data: row as T, error: null };
    }

    return { data: rows, error: null, count: this._countMode ? rows.length : null };
  }

  private async _resolveJoins(client: pg.PoolClient, rows: T[]): Promise<T[]> {
    if (!rows.length) return rows;

    const joinRe = /(\w+)\(([^)]+)\)/g;
    const joins: { rel: string; cols: string[] }[] = [];
    let m: RegExpExecArray | null;
    while ((m = joinRe.exec(this._select)) !== null) {
      joins.push({ rel: m[1], cols: m[2].split(',').map(c => c.trim()) });
    }

    if (!joins.length) return rows;

    const result = [...rows] as Record<string, unknown>[];

    for (const join of joins) {
      const relTable = join.rel;
      const fkCol = `${relTable.replace(/s$/, '')}_id`;

      const ids = [...new Set(result.map(r => r[fkCol]).filter(Boolean))];
      if (!ids.length) {
        result.forEach(r => { r[relTable] = null; });
        continue;
      }

      const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
      const colsSql = join.cols.map(c => `"${c}"`).join(', ');
      const relSql = `SELECT "id", ${colsSql} FROM "${relTable}" WHERE "id" IN (${placeholders})`;
      const relResult = await client.query(relSql, ids);
      const relMap = new Map(relResult.rows.map(r => [r.id, r]));

      result.forEach(r => {
        const fkVal = r[fkCol];
        r[relTable] = fkVal ? (relMap.get(fkVal as string) ?? null) : null;
      });
    }

    return result as T[];
  }

  private async _runInsert(client: pg.PoolClient, data: Record<string, unknown>): Promise<QueryResult<T> | QueryResultMany<T>> {
    const keys   = Object.keys(data);
    const cols   = keys.map(k => `"${k}"`).join(', ');
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const values = keys.map(k => data[k]);

    const sql = `INSERT INTO "${this._table}" (${cols}) VALUES (${placeholders}) RETURNING *`;
    const result = await client.query(sql, values);
    const row = result.rows[0] as T ?? null;

    if (this._select !== '*') {
      const enriched = await this._resolveJoins(client, row ? [row] : []);
      const enrichedRow = enriched[0] ?? null;
      if (this._single || this._maybeSingle || this._returning) {
        return { data: enrichedRow as T, error: null };
      }
      return { data: enrichedRow ? [enrichedRow] as T[] : [], error: null };
    }

    if (this._single || this._maybeSingle || this._returning) {
      return { data: row, error: null };
    }
    return { data: row ? [row] as T[] : [], error: null };
  }

  private async _runInsertMany(client: pg.PoolClient, dataArr: Record<string, unknown>[]): Promise<QueryResultMany<T>> {
    if (!dataArr.length) return { data: [], error: null };
    const keys = Object.keys(dataArr[0]);
    const cols = keys.map(k => `"${k}"`).join(', ');
    const rows: unknown[] = [];
    const allValues: unknown[] = [];
    let idx = 1;
    for (const d of dataArr) {
      const placeholders = keys.map(() => `$${idx++}`).join(', ');
      rows.push(`(${placeholders})`);
      keys.forEach(k => allValues.push(d[k]));
    }
    const sql = `INSERT INTO "${this._table}" (${cols}) VALUES ${rows.join(', ')} RETURNING *`;
    const result = await client.query(sql, allValues);
    return { data: result.rows as T[], error: null };
  }

  private async _runUpsert(client: pg.PoolClient, upsert: { data: Record<string, unknown>; onConflict?: string }): Promise<QueryResult<T>> {
    const { data, onConflict } = upsert;
    const keys = Object.keys(data);
    const cols = keys.map(k => `"${k}"`).join(', ');
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const values = keys.map(k => data[k]);
    const conflictCol = onConflict ? `"${onConflict}"` : cols.split(',')[0];
    const updates = keys.filter(k => k !== onConflict).map(k => `"${k}" = EXCLUDED."${k}"`).join(', ');

    const sql = `INSERT INTO "${this._table}" (${cols}) VALUES (${placeholders})
      ON CONFLICT (${conflictCol}) DO UPDATE SET ${updates} RETURNING *`;
    const result = await client.query(sql, values);
    return { data: result.rows[0] as T ?? null, error: null };
  }

  private async _runUpdate(client: pg.PoolClient, data: Record<string, unknown>): Promise<QueryResult<T> | QueryResultMany<T>> {
    const keys = Object.keys(data);
    let idx = 1;
    const sets = keys.map(k => `"${k}" = $${idx++}`).join(', ');
    const values = keys.map(k => data[k]);

    const { clause, params } = this._buildWhere(idx);
    const allValues = [...values, ...params];

    let sql = `UPDATE "${this._table}" SET ${sets} ${clause} RETURNING *`;

    const result = await client.query(sql, allValues);
    const rows = result.rows as T[];

    if (this._single || this._maybeSingle) {
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }

  private async _runDelete(client: pg.PoolClient): Promise<QueryResult<T> | QueryResultMany<T>> {
    const { clause, params } = this._buildWhere(1);
    const sql = `DELETE FROM "${this._table}" ${clause}`;
    await client.query(sql, params);
    return { data: null, error: null };
  }
}

function from(table: string) {
  return {
    select(cols = '*', opts?: { count?: 'exact'; head?: boolean }) {
      return new QueryBuilder(table).select(cols, opts);
    },
    insert(data: Record<string, unknown> | Record<string, unknown>[]) {
      return new QueryBuilder(table).insert(data);
    },
    update(data: Record<string, unknown>) {
      return new QueryBuilder(table).update(data);
    },
    delete() {
      return new QueryBuilder(table).delete();
    },
    upsert(data: Record<string, unknown>, opts?: { onConflict?: string }) {
      return new QueryBuilder(table).upsert(data, opts);
    },
  };
}

export const supabaseAdmin = { from };
export const supabaseClient = { from };
export const supabaseUrl = '';

export { pool };
