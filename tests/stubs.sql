-- Minimal stand-ins for the Supabase-managed schemas (auth, storage, vault, pg_net, realtime).
-- Local testing only — never run this on the real project.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated;
create schema auth; grant usage on schema auth to anon, authenticated;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
create schema storage; grant usage on schema storage to anon, authenticated;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant all on storage.objects to authenticated;
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create schema net;
create table net.calls (id bigserial primary key, url text, body jsonb, headers jsonb);
create table net._http_response (id bigint, status_code int, content text, error_msg text);
create function net.http_post(url text, body jsonb, headers jsonb) returns bigint language sql as $$
  insert into net.calls(url, body, headers) values (url, body, headers) returning id $$;
create publication supabase_realtime;
