-- ════════════════════════════════════════════════════════════════════════════
-- ALLURE Boutique — database schema for Supabase
-- settings.data.delivery is an ordered list: [{"city":"Cairo","fee":70}, ...]
-- Run this whole file once in Supabase → SQL Editor → New query → Run.
-- It is safe to run again after edits (tables are kept, functions/policies replaced).
-- Then run seed.sql to load the starting catalogue and settings.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pg_net;

-- ─────────────────────────────── tables ───────────────────────────────

create table if not exists public.settings (
  id         int primary key default 1 check (id = 1),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id            text primary key,
  code          text not null unique,
  name          text not null,
  cat           text not null,
  sub           text,
  price         int  not null check (price >= 0),
  old_price     int  check (old_price is null or old_price >= 0),
  material      text not null default '',
  size          text not null default '',
  color         text not null default '',
  comes_with    text[] not null default '{}',
  description   text not null default '',
  flags         jsonb not null default '{}'::jsonb,      -- {"sale":true,"best":true,"new":true}
  stock         int  not null default 0 check (stock >= 0),
  rating        numeric(2,1) not null default 5,
  reviews_count int  not null default 0,
  popularity    int  not null default 0,
  images        text[] not null default '{}',           -- public URLs in the product-images bucket
  bg            text not null default 'linear-gradient(150deg,#e0cd9e,#b18f48)',
  options       jsonb not null default '{}'::jsonb,      -- colors / letters / ringSizes / bagSizes / setParts
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Arabic versions of product text (optional — the shop falls back to English when empty)
alter table public.products add column if not exists name_ar        text   not null default '';
alter table public.products add column if not exists description_ar text   not null default '';
alter table public.products add column if not exists material_ar    text   not null default '';
alter table public.products add column if not exists size_ar        text   not null default '';
alter table public.products add column if not exists color_ar       text   not null default '';
alter table public.products add column if not exists comes_with_ar  text[] not null default '{}';

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null default '',
  phone      text not null default '',
  email      text not null default '',
  role       text not null default 'customer' check (role in ('customer','admin')),
  created_at timestamptz not null default now()
);

create sequence if not exists public.order_no_seq start 10231;

create table if not exists public.orders (
  id             bigint generated always as identity primary key,
  order_no       text not null unique default ('AL' || nextval('public.order_no_seq')),
  user_id        uuid references auth.users(id) on delete set null,
  customer       jsonb not null,                        -- {name,email,phone,phone2}
  fulfil         text not null check (fulfil in ('delivery','pickup')),
  city           text,
  address        text not null default '',
  note           text not null default '',
  payment        text not null check (payment in ('cod','instapay')),
  payment_status text not null default 'awaiting' check (payment_status in ('awaiting','confirmed','not_required')),
  items          jsonb not null,                        -- snapshot: [{id,name,code,qty,unit,opts,image,bg}]
  subtotal       int not null,
  discount       int not null default 0,
  promo_code     text,
  delivery_fee   int not null default 0,
  total          int not null,
  status         text not null default 'pending' check (status in ('pending','shipped','received','cancelled')),
  history        jsonb not null default '{}'::jsonb,    -- {"cart":ts,"pending":ts,"shipped":ts,...}
  admin_note     text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists orders_user_idx    on public.orders(user_id);
create index if not exists orders_created_idx on public.orders(created_at desc);

create table if not exists public.promo_codes (
  code       text primary key check (code = upper(code)),
  percent    int not null check (percent between 1 and 90),
  active     boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id) on delete cascade default auth.uid(),
  name       text not null default '',
  rating     int  not null check (rating between 1 and 5),
  text       text not null check (char_length(text) between 1 and 1000),
  approved   boolean not null default false,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────── helpers ───────────────────────────────

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- new sign-ups get a profile row (name/phone come from the sign-up form metadata)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, phone)
  values (new.id, coalesce(new.email, ''),
          coalesce(new.raw_user_meta_data->>'name', ''),
          coalesce(new.raw_user_meta_data->>'phone', ''))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();
drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings for each row execute function public.touch_updated_at();

-- reviews always carry the author's account name (no spoofing)
create or replace function public.review_set_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null then
    select coalesce(nullif(name, ''), 'Client') into new.name from public.profiles where id = new.user_id;
  end if;
  return new;
end $$;
drop trigger if exists reviews_set_name on public.reviews;
create trigger reviews_set_name before insert on public.reviews for each row execute function public.review_set_name();

-- ─────────────────────────────── order status changes ───────────────────────────────
-- Keeps the tracking history and puts stock back when an order is cancelled.
create or replace function public.order_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    new.history := coalesce(old.history, '{}'::jsonb) || jsonb_build_object(new.status, now());
    if new.status = 'cancelled' and old.status <> 'cancelled' then
      for it in select * from jsonb_array_elements(old.items) loop
        update public.products set stock = stock + (it->>'qty')::int where id = it->>'id';
      end loop;
    elsif old.status = 'cancelled' and new.status <> 'cancelled' then
      for it in select * from jsonb_array_elements(old.items) loop
        update public.products set stock = greatest(stock - (it->>'qty')::int, 0) where id = it->>'id';
      end loop;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_before_update on public.orders;
create trigger orders_before_update before update on public.orders for each row execute function public.order_before_update();

-- ─────────────────────────────── checkout ───────────────────────────────

create or replace function public.check_promo(p_code text)
returns int language sql stable security definer set search_path = public as $$
  select percent from public.promo_codes
  where code = upper(trim(p_code)) and active and (expires_at is null or expires_at > now());
$$;

-- Places an order. Everything that matters (prices, stock, fees, discount) is
-- recomputed here from the database — nothing the browser sends is trusted.
create or replace function public.place_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s        jsonb;
  cust     jsonb := coalesce(payload->'customer', '{}'::jsonb);
  v_name   text  := trim(coalesce(cust->>'name', ''));
  v_email  text  := lower(trim(coalesce(cust->>'email', '')));
  v_phone  text  := regexp_replace(coalesce(cust->>'phone', ''), '\s', '', 'g');
  v_phone2 text  := regexp_replace(coalesce(cust->>'phone2', ''), '\s', '', 'g');
  v_fulfil text  := payload->>'fulfil';
  v_pay    text  := payload->>'payment';
  v_city   text  := nullif(trim(coalesce(payload->>'city', '')), '');
  addr     jsonb := coalesce(payload->'address', '{}'::jsonb);
  v_addr   text  := '';
  line     jsonb;
  p        public.products%rowtype;
  opts     jsonb;
  qty      int;
  unit     int;
  parts    jsonb;
  all_parts int;
  items    jsonb := '[]'::jsonb;
  sub      int := 0;
  pct      int;
  disc     int := 0;
  fee      int := 0;
  v_promo  text := nullif(upper(trim(coalesce(payload->>'promo', ''))), '');
  v_pstat  text;
  o        public.orders%rowtype;
  need     record;
begin
  select data into s from public.settings where id = 1;

  -- customer
  if char_length(v_name) < 2 then raise exception 'INVALID:name'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID:email'; end if;
  if v_phone !~ '^01[0125][0-9]{8}$' then raise exception 'INVALID:phone'; end if;
  if v_phone2 <> '' and v_phone2 !~ '^01[0125][0-9]{8}$' then raise exception 'INVALID:phone2'; end if;
  if v_pay not in ('cod','instapay') then raise exception 'INVALID:payment'; end if;

  -- simple flood guard
  if (select count(*) from public.orders where customer->>'phone' = v_phone and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'RATE_LIMIT';
  end if;

  -- delivery
  if v_fulfil = 'delivery' then
    select (d->>'fee')::int into fee from jsonb_array_elements(coalesce(s->'delivery', '[]'::jsonb)) d where d->>'city' = v_city limit 1;
    if v_city is null or fee is null then raise exception 'INVALID:city'; end if;
    if coalesce(trim(addr->>'region'), '') = '' then raise exception 'INVALID:region'; end if;
    if coalesce(trim(addr->>'street'), '') = '' then raise exception 'INVALID:street'; end if;
    if coalesce(trim(addr->>'building'), '') = '' then raise exception 'INVALID:building'; end if;
    v_addr := concat_ws(', ', nullif(trim(addr->>'apartment'), ''), trim(addr->>'building'), trim(addr->>'street'), trim(addr->>'region'), v_city);
  elsif v_fulfil = 'pickup' then
    fee := 0; v_city := null;
    v_addr := coalesce(s->>'address', 'Our branch');
  else
    raise exception 'INVALID:fulfil';
  end if;

  -- items
  if jsonb_typeof(payload->'items') <> 'array' or jsonb_array_length(payload->'items') = 0 then raise exception 'EMPTY_CART'; end if;
  if jsonb_array_length(payload->'items') > 30 then raise exception 'INVALID:items'; end if;
  if exists (select 1 from jsonb_array_elements(payload->'items') l
             where jsonb_typeof(l->'qty') <> 'number' or (l->>'qty') !~ '^[0-9]+$' or jsonb_typeof(l->'id') <> 'string')
    then raise exception 'INVALID:qty'; end if;

  -- stock check per product (lines with different options share stock)
  for need in
    select l->>'id' as pid, sum((l->>'qty')::int) as q
    from jsonb_array_elements(payload->'items') l group by l->>'id'
  loop
    select * into p from public.products where id = need.pid and active for update;
    if not found then raise exception 'NOT_FOUND:%', need.pid; end if;
    if need.q < 1 or need.q > 50 then raise exception 'INVALID:qty'; end if;
    if p.stock < need.q then raise exception 'OUT_OF_STOCK:%', p.name; end if;
  end loop;

  for line in select * from jsonb_array_elements(payload->'items') loop
    select * into p from public.products where id = line->>'id';
    qty  := (line->>'qty')::int;
    if qty < 1 or qty > 10 then raise exception 'INVALID:qty'; end if;
    opts := coalesce(line->'opts', '{}'::jsonb);

    -- every option group the product defines must be chosen from its allowed values
    if p.options ? 'colors' and not exists (select 1 from jsonb_array_elements(p.options->'colors') c where c->>'name' = opts->>'color')
      then raise exception 'OPTION:%:color', p.name; end if;
    if p.options ? 'letters' and not exists (select 1 from jsonb_array_elements_text(p.options->'letters') x where x = opts->>'letter')
      then raise exception 'OPTION:%:letter', p.name; end if;
    if p.options ? 'ringSizes' and not exists (select 1 from jsonb_array_elements_text(p.options->'ringSizes') x where x = opts->>'ringSize')
      then raise exception 'OPTION:%:ringSize', p.name; end if;
    if p.options ? 'bagSizes' and not exists (select 1 from jsonb_array_elements_text(p.options->'bagSizes') x where x = opts->>'bagSize')
      then raise exception 'OPTION:%:bagSize', p.name; end if;

    unit := p.price;
    if p.options ? 'setParts' then
      parts := coalesce(opts->'parts', '[]'::jsonb);
      if jsonb_typeof(parts) <> 'array' or jsonb_array_length(parts) = 0 then raise exception 'OPTION:%:parts', p.name; end if;
      if exists (select 1 from jsonb_array_elements_text(parts) x
                 where not exists (select 1 from jsonb_array_elements(p.options->'setParts') sp where sp->>'name' = x))
        then raise exception 'OPTION:%:parts', p.name; end if;
      all_parts := jsonb_array_length(p.options->'setParts');
      if (select count(distinct x) from jsonb_array_elements_text(parts) x) < all_parts then
        select coalesce(sum((sp->>'price')::int), 0) into unit
        from jsonb_array_elements(p.options->'setParts') sp
        where sp->>'name' in (select jsonb_array_elements_text(parts));
      end if;
    end if;

    -- keep only recognised option keys in the snapshot
    opts := jsonb_strip_nulls(jsonb_build_object(
      'color', opts->>'color', 'letter', opts->>'letter', 'ringSize', opts->>'ringSize',
      'bagSize', opts->>'bagSize', 'parts', case when p.options ? 'setParts' then opts->'parts' end));

    sub := sub + unit * qty;
    items := items || jsonb_build_array(jsonb_build_object(
      'id', p.id, 'name', p.name, 'code', p.code, 'qty', qty, 'unit', unit, 'opts', opts,
      'image', p.images[1], 'bg', p.bg));
    update public.products set stock = stock - qty, popularity = popularity + qty where id = p.id;
  end loop;

  if v_promo is not null then
    pct := public.check_promo(v_promo);
    if pct is null then raise exception 'INVALID:promo'; end if;
    disc := round(sub * pct / 100.0);
  end if;

  v_pstat := case when v_pay = 'instapay' then 'awaiting'
                  when fee > 0 then 'awaiting'          -- COD: delivery fee is prepaid by InstaPay
                  else 'not_required' end;

  insert into public.orders (user_id, customer, fulfil, city, address, note, payment, payment_status,
                             items, subtotal, discount, promo_code, delivery_fee, total, history)
  values (auth.uid(),
          jsonb_build_object('name', v_name, 'email', v_email, 'phone', v_phone, 'phone2', v_phone2),
          v_fulfil, v_city, v_addr, left(coalesce(payload->>'note', ''), 1000), v_pay, v_pstat,
          items, sub, disc, v_promo, fee, sub - disc + fee,
          jsonb_build_object('cart', now(), 'pending', now()))
  returning * into o;

  return jsonb_build_object(
    'order_no', o.order_no, 'subtotal', o.subtotal, 'discount', o.discount, 'delivery_fee', o.delivery_fee,
    'total', o.total, 'payment', o.payment, 'payment_status', o.payment_status, 'fulfil', o.fulfil,
    'address', o.address, 'items', o.items, 'customer', o.customer, 'status', o.status,
    'history', o.history, 'created_at', o.created_at);
end $$;

-- Guest tracking: order number + the phone used at checkout.
create or replace function public.track_order(p_order_no text, p_phone text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('order_no', order_no, 'status', status, 'history', history, 'created_at', created_at,
                            'items', items, 'total', total, 'subtotal', subtotal, 'discount', discount,
                            'delivery_fee', delivery_fee, 'payment', payment, 'payment_status', payment_status,
                            'fulfil', fulfil, 'address', address)
  from public.orders
  where order_no = upper(trim(p_order_no))
    and customer->>'phone' = regexp_replace(coalesce(p_phone, ''), '\s', '', 'g');
$$;

-- ─────────────────────────────── Telegram notifications ───────────────────────────────
-- Bot token + chat id live in Supabase Vault (see SETUP.md). They never reach the browser.

create or replace function public.tg_esc(t text)
returns text language sql immutable as $$
  select replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
$$;

create or replace function public.telegram_send(msg text)
returns bigint language plpgsql security definer set search_path = public as $$
declare tok text; chat text; rid bigint;
begin
  select decrypted_secret into tok  from vault.decrypted_secrets where name = 'telegram_bot_token' limit 1;
  select decrypted_secret into chat from vault.decrypted_secrets where name = 'telegram_chat_id'   limit 1;
  if tok is null or chat is null then return null; end if;
  select net.http_post(
    url     := 'https://api.telegram.org/bot' || tok || '/sendMessage',
    body    := jsonb_build_object('chat_id', chat, 'text', msg, 'parse_mode', 'HTML', 'disable_web_page_preview', true),
    headers := '{"Content-Type":"application/json"}'::jsonb
  ) into rid;
  return rid;
end $$;

create or replace function public.order_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare msg text; lines text; dash text;
begin
  select string_agg('• ' || (i->>'qty') || ' × ' || tg_esc(i->>'name') ||
           coalesce(' <i>(' || nullif(tg_esc(concat_ws(', ', i->'opts'->>'color', i->'opts'->>'letter',
             i->'opts'->>'ringSize', i->'opts'->>'bagSize',
             (select string_agg(x, '+') from jsonb_array_elements_text(coalesce(i->'opts'->'parts', '[]'::jsonb)) x))), '') || ')</i>', '') ||
           ' — ' || to_char((i->>'unit')::int * (i->>'qty')::int, 'FM999,999,990') || ' LE', E'\n')
    into lines from jsonb_array_elements(new.items) i;
  select data->>'dashboardUrl' into dash from public.settings where id = 1;

  msg := '🛍 <b>New order ' || new.order_no || '</b>' || E'\n\n' ||
         '👤 ' || tg_esc(new.customer->>'name') || E'\n' ||
         '📞 ' || tg_esc(new.customer->>'phone') || coalesce(nullif(' / ' || tg_esc(new.customer->>'phone2'), ' / '), '') || E'\n' ||
         case when new.fulfil = 'pickup' then '🏬 Pickup from branch' else '🚚 ' || tg_esc(new.address) end || E'\n' ||
         '💳 ' || case when new.payment = 'instapay' then 'InstaPay / VC — awaiting transfer'
                       when new.payment_status = 'awaiting' then 'Cash on delivery — delivery fee by InstaPay'
                       else 'Cash on delivery' end || E'\n\n' ||
         lines || E'\n\n' ||
         case when new.discount > 0 then 'Discount (' || tg_esc(new.promo_code) || '): −' || to_char(new.discount, 'FM999,999,990') || ' LE' || E'\n' else '' end ||
         'Delivery: ' || to_char(new.delivery_fee, 'FM999,999,990') || ' LE' || E'\n' ||
         '<b>Total: ' || to_char(new.total, 'FM999,999,990') || ' LE</b>' ||
         case when new.note <> '' then E'\n\n📝 ' || tg_esc(new.note) else '' end ||
         case when dash is not null and dash <> '' then E'\n\n' || dash else '' end;

  perform public.telegram_send(msg);
  return new;
exception when others then
  return new;   -- a notification problem must never block an order
end $$;
drop trigger if exists orders_notify on public.orders;
create trigger orders_notify after insert on public.orders for each row execute function public.order_notify();

-- dashboard helpers
create or replace function public.admin_telegram_status()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'token', exists (select 1 from vault.decrypted_secrets where name = 'telegram_bot_token'),
    'chat',  exists (select 1 from vault.decrypted_secrets where name = 'telegram_chat_id'));
end $$;

create or replace function public.admin_test_telegram()
returns bigint language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return public.telegram_send('✅ <b>ALLURE Boutique</b>' || E'\n' || 'Telegram notifications are working. You will get a message here for every new order.');
end $$;

create or replace function public.admin_http_result(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select jsonb_build_object('status_code', status_code, 'content', left(content, 400), 'error', error_msg)
    into r from net._http_response where id = p_id;
  return r;
end $$;

-- ─────────────────────────────── row level security ───────────────────────────────

alter table public.settings    enable row level security;
alter table public.products    enable row level security;
alter table public.profiles    enable row level security;
alter table public.orders      enable row level security;
alter table public.promo_codes enable row level security;
alter table public.reviews     enable row level security;

drop policy if exists settings_read  on public.settings;
drop policy if exists settings_write on public.settings;
create policy settings_read  on public.settings for select using (true);
create policy settings_write on public.settings for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists products_read   on public.products;
drop policy if exists products_insert on public.products;
drop policy if exists products_update on public.products;
drop policy if exists products_delete on public.products;
create policy products_read   on public.products for select using (active or public.is_admin());
create policy products_insert on public.products for insert with check (public.is_admin());
create policy products_update on public.products for update using (public.is_admin()) with check (public.is_admin());
create policy products_delete on public.products for delete using (public.is_admin());

drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_read   on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists orders_read   on public.orders;
drop policy if exists orders_update on public.orders;
create policy orders_read   on public.orders for select using (user_id = auth.uid() or public.is_admin());
create policy orders_update on public.orders for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists promo_admin on public.promo_codes;
create policy promo_admin on public.promo_codes for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists reviews_read   on public.reviews;
drop policy if exists reviews_insert on public.reviews;
drop policy if exists reviews_update on public.reviews;
drop policy if exists reviews_delete on public.reviews;
create policy reviews_read   on public.reviews for select using (approved or user_id = auth.uid() or public.is_admin());
create policy reviews_insert on public.reviews for insert to authenticated with check (user_id = auth.uid() and approved = false);
create policy reviews_update on public.reviews for update using (public.is_admin()) with check (public.is_admin());
create policy reviews_delete on public.reviews for delete using (public.is_admin());

-- table access for the browser roles (RLS above decides which rows)
grant usage on schema public to anon, authenticated;
grant select on public.settings, public.products, public.reviews to anon, authenticated;
grant select on public.profiles, public.orders, public.promo_codes to authenticated;
grant update on public.settings to authenticated;
grant insert, update, delete on public.products, public.promo_codes to authenticated;
grant insert, delete on public.reviews to authenticated;

-- column-level limits on top of RLS
revoke insert, update, delete on public.profiles from anon, authenticated;
grant  update (name, phone) on public.profiles to authenticated;           -- customers can never change their role
revoke insert, delete on public.orders from anon, authenticated;            -- orders only via place_order()
revoke update on public.orders from anon, authenticated;
grant  update (status, payment_status, admin_note) on public.orders to authenticated;  -- RLS limits this to admins
revoke update on public.reviews from anon, authenticated;
grant  update (approved) on public.reviews to authenticated;               -- RLS limits this to admins

-- functions: only the public entry points are callable from the browser
revoke execute on function public.telegram_send(text)  from public, anon, authenticated;
revoke execute on function public.order_notify()        from public, anon, authenticated;
revoke execute on function public.handle_new_user()     from public, anon, authenticated;
grant  execute on function public.place_order(jsonb)    to anon, authenticated;
grant  execute on function public.track_order(text, text) to anon, authenticated;
grant  execute on function public.check_promo(text)     to anon, authenticated;
grant  execute on function public.is_admin()            to anon, authenticated;
revoke execute on function public.admin_telegram_status() from public, anon;
revoke execute on function public.admin_test_telegram()   from public, anon;
revoke execute on function public.admin_http_result(bigint) from public, anon;
grant  execute on function public.admin_telegram_status() to authenticated;
grant  execute on function public.admin_test_telegram()   to authenticated;
grant  execute on function public.admin_http_result(bigint) to authenticated;

-- ─────────────────────────────── product photos ───────────────────────────────

insert into storage.buckets (id, name, public) values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

drop policy if exists product_images_admin_insert on storage.objects;
drop policy if exists product_images_admin_update on storage.objects;
drop policy if exists product_images_admin_delete on storage.objects;
create policy product_images_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());
create policy product_images_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin());
create policy product_images_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

-- ─────────────────────────────── realtime ───────────────────────────────
-- Dashboard hears new orders instantly; customers see their status change live.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders') then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

-- ─────────────────────────────── visitor insights ───────────────────────────────
-- Anonymous visit events for the dashboard's Insights page: no names, phones or IP addresses —
-- just a random visitor id kept in the browser. "Live now" numbers use Realtime Presence and store nothing.

create table if not exists public.events (
  id         bigint generated always as identity primary key,
  visitor    text not null check (char_length(visitor) between 8 and 40),
  session    text not null check (char_length(session) between 8 and 40),
  type       text not null check (type in ('page_view','product_view','add_to_cart','checkout_start','order_placed')),
  path       text not null default '' check (char_length(path) <= 200),
  product_id text check (char_length(product_id) <= 100),
  referrer   text not null default '' check (char_length(referrer) <= 100),
  device     text not null default '' check (device in ('','mobile','tablet','desktop')),
  created_at timestamptz not null default now()
);
create index if not exists events_created_idx on public.events(created_at desc);
create index if not exists events_visitor_idx on public.events(visitor, created_at desc);
alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;     -- written only by track_event(), read only by admin_insights()

create or replace function public.track_event(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v text := left(coalesce(p->>'visitor', ''), 40);
  s text := left(coalesce(p->>'session', ''), 40);
begin
  if coalesce(p->>'type', '') not in ('page_view','product_view','add_to_cart','checkout_start','order_placed') then return; end if;
  if char_length(v) < 8 or char_length(s) < 8 then return; end if;
  if public.is_admin() then return; end if;                                   -- the owner's own browsing isn't counted
  if (select count(*) from public.events where visitor = v and created_at > now() - interval '1 hour') >= 300 then return; end if;
  insert into public.events (visitor, session, type, path, product_id, referrer, device)
  values (v, s, p->>'type', left(coalesce(p->>'path', ''), 200), left(nullif(p->>'product_id', ''), 100),
          left(coalesce(p->>'referrer', ''), 100),
          case when p->>'device' in ('mobile','tablet','desktop') then p->>'device' else '' end);
end $$;

create or replace function public.admin_insights(p_days int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tz    text := 'Africa/Cairo';
  d     int := greatest(1, least(coalesce(p_days, 30), 366));
  today timestamp := date_trunc('day', now() at time zone tz);
  since timestamptz := (today - make_interval(days => d - 1)) at time zone tz;
  r     jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  delete from public.events where created_at < now() - interval '400 days';   -- keep about a year

  with e as (select * from public.events where created_at >= since),
  s as (
    select session, bool_or(type = 'product_view') pv, bool_or(type = 'add_to_cart') ac,
           bool_or(type = 'checkout_start') co, bool_or(type = 'order_placed') op, max(created_at) last_at,
           coalesce(max(nullif(referrer, '')), 'direct') source
    from e group by session)
  select jsonb_build_object(
    'since', since,
    'totals', (select jsonb_build_object(
        'page_views',    count(*) filter (where type = 'page_view'),
        'visitors',      count(distinct visitor),
        'sessions',      count(distinct session),
        'product_views', count(*) filter (where type = 'product_view'),
        'add_to_cart',   count(*) filter (where type = 'add_to_cart'),
        'checkouts',     count(distinct session) filter (where type = 'checkout_start'),
        'orders',        count(distinct session) filter (where type = 'order_placed')) from e),
    'funnel', (select jsonb_build_object('sessions', count(*), 'product', count(*) filter (where pv),
        'cart', count(*) filter (where ac), 'checkout', count(*) filter (where co), 'order', count(*) filter (where op)) from s),
    'abandoned', (select count(*) from s where ac and not op and last_at < now() - interval '1 hour'),
    'daily', (select jsonb_agg(jsonb_build_object('day', to_char(x.dd, 'YYYY-MM-DD'), 'views', coalesce(v.views, 0), 'visitors', coalesce(v.visitors, 0)) order by x.dd)
              from (select (today - make_interval(days => i))::date dd from generate_series(0, d - 1) i) x
              left join (select (created_at at time zone tz)::date dd, count(*) filter (where type = 'page_view') views,
                                count(distinct visitor) visitors from e group by 1) v on v.dd = x.dd),
    'products', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select e.product_id id, coalesce(p.name, e.product_id) name,
               count(*) filter (where e.type = 'product_view') views, count(*) filter (where e.type = 'add_to_cart') adds
        from e left join public.products p on p.id = e.product_id
        where e.product_id is not null group by e.product_id, p.name order by 3 desc, 4 desc limit 10) t),
    'sources', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select source, count(*) sessions from s group by 1 order by 2 desc limit 8) t),
    'devices', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select coalesce(nullif(device, ''), 'unknown') device, count(distinct visitor) visitors from e group by 1 order by 2 desc) t),
    'pages', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select path, count(*) views from e where type = 'page_view' group by 1 order by 2 desc limit 8) t)
  ) into r;
  return r;
end $$;

revoke execute on function public.track_event(jsonb)  from public;
revoke execute on function public.admin_insights(int) from public, anon;
grant  execute on function public.track_event(jsonb)  to anon, authenticated;
grant  execute on function public.admin_insights(int) to authenticated;
