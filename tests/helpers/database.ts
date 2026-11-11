import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

/** Real PostgreSQL engine; only Supabase's platform-owned auth/storage are stubbed. */
export async function createTestDatabase(beforeMigration?: (db: PGlite, file: string) => Promise<void>) {
  const db = new PGlite()
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE TABLE auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user) $$;
    CREATE TABLE storage.buckets(id text primary key, name text, public boolean);
    CREATE TABLE storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner_id text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1,'/') $$;
    GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA auth,storage TO service_role;
    GRANT ALL ON storage.objects TO authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role;
  `)
  const directory = new URL('../../supabase/migrations/', import.meta.url)
  for (const file of (await readdir(directory)).filter(f => f.endsWith('.sql')).sort()) {
    await beforeMigration?.(db, file)
    try { await db.exec(`BEGIN;\n${await readFile(new URL(file, directory), 'utf8')}\nCOMMIT;`) }
    catch (e) { await db.close(); throw new Error(`Migration ${file}: ${(e as Error).message}`, { cause: e }) }
  }
  return db
}

export async function seedUser(db: PGlite, role: string, options: { actif?: boolean, id?: string } = {}) {
  const id = options.id ?? randomUUID()
  await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@example.test`])
  await db.query('update public.profiles set role=$2::public.user_role, actif=$3 where id=$1', [id, role, options.actif ?? true])
  return id
}

/** Always roll back role-scoped probes, including failures. Never swallow policy errors. */
export async function asUser<T>(db: PGlite, id: string, callback: () => Promise<T>) {
  await db.exec('BEGIN; SET LOCAL ROLE authenticated;')
  await db.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role','authenticated',true)", [id])
  try { return await callback() }
  finally { await db.exec('ROLLBACK;') }
}
