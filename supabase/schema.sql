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

-- size chart picture per product (optional)
alter table public.products add column if not exists size_chart text not null default '';

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null default '',
  phone      text not null default '',
  email      text not null default '',
  role       text not null default 'customer' check (role in ('customer','admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists blocked        boolean not null default false;
alter table public.profiles add column if not exists blocked_reason text not null default '';
alter table public.profiles add column if not exists blocked_at     timestamptz;

-- team: one main owner ('owner') plus staff ('admin') with chosen permissions
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('customer','admin','owner'));
alter table public.profiles add column if not exists perms      text[]  not null default '{}';   -- staff permissions, e.g. {orders.view,orders.manage}
alter table public.profiles add column if not exists suspended  boolean not null default false;  -- staff access paused
alter table public.profiles add column if not exists staff_note text    not null default '';     -- owner's internal note about a customer

-- staff the owner has invited; applied when that email signs up
create table if not exists public.staff_invites (
  email      text primary key check (email = lower(email)),
  name       text not null default '',
  perms      text[] not null default '{}',
  invited_by uuid,
  created_at timestamptz not null default now()
);

-- saved delivery addresses (customers pick one at checkout)
create table if not exists public.addresses (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  label      text not null default '' check (char_length(label) <= 40),
  city       text not null check (char_length(city) between 1 and 80),
  region     text not null check (char_length(region) between 1 and 120),
  street     text not null check (char_length(street) between 1 and 160),
  building   text not null check (char_length(building) between 1 and 60),
  apartment  text not null default '' check (char_length(apartment) <= 60),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists addresses_user_idx on public.addresses(user_id);

-- who did what in the dashboard (written by triggers; read on the Activity page)
create table if not exists public.activity (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  actor_name text not null default '',
  action     text not null,                 -- insert | update | delete | sign_in | export | …
  entity     text not null default '',      -- orders | products | settings | profiles | …
  entity_id  text not null default '',
  label      text not null default '',      -- order number, product name, customer name…
  details    jsonb not null default '{}'::jsonb
);
create index if not exists activity_at_idx     on public.activity(at desc);
create index if not exists activity_entity_idx on public.activity(entity, entity_id);
create index if not exists activity_actor_idx  on public.activity(actor, at desc);

-- Telegram chats that get a message for every order (each staff member connects their own with one tap)
create table if not exists public.telegram_chats (
  chat_id    text primary key,
  title      text not null default '',
  kind       text not null default 'private',
  user_id    uuid references auth.users(id) on delete cascade,   -- who connected it
  created_at timestamptz not null default now()
);
create table if not exists public.telegram_codes (
  code       text primary key,
  user_id    uuid not null,
  created_at timestamptz not null default now()
);
create table if not exists public.telegram_bot (
  id       int primary key default 1 check (id = 1),
  username text not null default ''
);

-- phone numbers that may not place orders (guests and accounts alike)
create table if not exists public.blocked_phones (
  phone      text primary key,
  reason     text not null default '',
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
-- order statuses: pending → shipped → received, plus cancelled / refunded (return) / exchanged
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending','shipped','received','cancelled','refunded','exchanged'));
alter table public.orders add column if not exists lang      text    not null default 'en';    -- customer's shop language (for emails)
alter table public.orders add column if not exists refunded  int     not null default 0;       -- money returned to the customer
alter table public.orders add column if not exists restocked boolean not null default false;   -- pieces already put back in stock
alter table public.orders add column if not exists changes   jsonb   not null default '[]'::jsonb;  -- edit / exchange / refund log
create index if not exists orders_user_idx    on public.orders(user_id);
create index if not exists orders_phone_idx   on public.orders((customer->>'phone'));
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

-- phone numbers are stored as 01xxxxxxxxx: '+20 101 234 5678', '201012345678' and '010 1234 5678' are all the same number
create or replace function public.norm_phone(p text)
returns text language sql immutable as $$
  select case
    when d ~ '^0020(1[0-9]{9})$' then '0' || substr(d, 5)
    when d ~ '^20(1[0-9]{9})$'   then '0' || substr(d, 3)
    when d ~ '^1[0-9]{9}$'       then '0' || d
    else d end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x;
$$;

-- staff = the owner or an admin whose access isn't paused
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('owner','admin') and not suspended);
$$;
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'owner');
$$;
-- can('orders.edit'): the owner can do everything; staff only what the owner ticked for them
create or replace function public.can(p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and not suspended
                 and (role = 'owner' or (role = 'admin' and p_perm = any(perms))));
$$;

-- new sign-ups get a profile row (name/phone come from the sign-up form metadata)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, phone)
  values (new.id, coalesce(new.email, ''),
          coalesce(new.raw_user_meta_data->>'name', ''),
          public.norm_phone(new.raw_user_meta_data->>'phone'))
  on conflict (id) do nothing;
  -- invited by the owner → becomes staff with the chosen permissions
  update public.profiles p set role = 'admin', perms = i.perms, suspended = false,
         name = coalesce(nullif(p.name, ''), i.name)
    from public.staff_invites i where p.id = new.id and i.email = lower(new.email) and p.role = 'customer';
  delete from public.staff_invites where email = lower(new.email);
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
-- Keeps the tracking history and puts stock back (exactly once) when an order is cancelled.
create or replace function public.order_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    new.history := coalesce(old.history, '{}'::jsonb) || jsonb_build_object(new.status, now());
    if new.status = 'cancelled' and not old.restocked then
      for it in select * from jsonb_array_elements(old.items) loop
        update public.products set stock = stock + (it->>'qty')::int where id = it->>'id';
      end loop;
      new.restocked := true;
    elsif new.status in ('pending','shipped','received','exchanged') and old.restocked then
      -- an order brought back from cancelled / returned takes its pieces out of stock again
      for it in select * from jsonb_array_elements(old.items) loop
        update public.products set stock = greatest(stock - (it->>'qty')::int, 0) where id = it->>'id';
      end loop;
      new.restocked := false;
    end if;
    -- moving a returned order back (e.g. the return was a mistake) cancels the refund amount
    if old.status = 'refunded' and new.status in ('pending','shipped','received','exchanged') and old.refunded > 0 then
      new.changes := coalesce(old.changes, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'at', now(), 'type', 'refund_undone', 'amount', old.refunded, 'note', ''));
      new.refunded := 0;
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

  -- blocked customers (account or phone) can't order online
  if exists (select 1 from public.blocked_phones where phone in (v_phone, nullif(v_phone2, '')))
     or exists (select 1 from public.profiles where id = auth.uid() and blocked) then
    raise exception 'BLOCKED';
  end if;

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
                             items, subtotal, discount, promo_code, delivery_fee, total, history, lang)
  values (auth.uid(),
          jsonb_build_object('name', v_name, 'email', v_email, 'phone', v_phone, 'phone2', v_phone2),
          v_fulfil, v_city, v_addr, left(coalesce(payload->>'note', ''), 1000), v_pay, v_pstat,
          items, sub, disc, v_promo, fee, sub - disc + fee,
          jsonb_build_object('cart', now(), 'pending', now()),
          case when payload->>'lang' = 'ar' then 'ar' else 'en' end)
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

-- Who gets order messages: the chat saved in Vault (optional) plus every chat a staff member connected
-- from the dashboard. A person's own chat stops getting messages if they lose access to orders.
create or replace function public.telegram_targets()
returns setof text language sql stable security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'telegram_chat_id' and coalesce(decrypted_secret, '') <> ''
  union
  select c.chat_id from public.telegram_chats c left join public.profiles p on p.id = c.user_id
  where p.id is not null and not p.suspended and (p.role = 'owner' or (p.role = 'admin' and 'orders.view' = any(p.perms)));
$$;

create or replace function public.telegram_call(method text, body jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare tok text; rid bigint;
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'telegram_bot_token' limit 1;
  if tok is null then return null; end if;
  select net.http_post(url := 'https://api.telegram.org/bot' || tok || '/' || method, body := body,
                       headers := '{"Content-Type":"application/json"}'::jsonb) into rid;
  return rid;
end $$;

create or replace function public.telegram_send_to(chat text, msg text)
returns bigint language sql security definer set search_path = public as $$
  select public.telegram_call('sendMessage', jsonb_build_object('chat_id', chat, 'text', msg, 'parse_mode', 'HTML', 'disable_web_page_preview', true));
$$;

create or replace function public.telegram_send(msg text)
returns bigint language plpgsql security definer set search_path = public as $$
declare chat text; rid bigint;
begin
  for chat in select * from public.telegram_targets() loop
    rid := public.telegram_send_to(chat, msg);
  end loop;
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
    'chat',  exists (select 1 from vault.decrypted_secrets where name = 'telegram_chat_id'),
    'bot',   (select nullif(username, '') from public.telegram_bot where id = 1),
    'chats', (select coalesce(jsonb_agg(jsonb_build_object('chat_id', c.chat_id, 'title', c.title, 'kind', c.kind,
                'user_id', c.user_id, 'who', coalesce(nullif(p.name, ''), p.email), 'created_at', c.created_at) order by c.created_at), '[]'::jsonb)
              from public.telegram_chats c left join public.profiles p on p.id = c.user_id
              where public.is_owner() or c.user_id = auth.uid()));
end $$;

-- sends a test to the caller's own chats (the owner: to everyone who gets order messages)
create or replace function public.admin_test_telegram()
returns bigint language plpgsql security definer set search_path = public as $$
declare chat text; rid bigint;
  msg text := '✅ <b>ALLURE Boutique</b>' || E'\n' || 'Telegram notifications are working. You will get a message here for every new order.';
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  for chat in select * from public.telegram_targets() t
              where public.is_owner() or t in (select chat_id from public.telegram_chats where user_id = auth.uid()) loop
    rid := public.telegram_send_to(chat, msg);
  end loop;
  return rid;
end $$;

-- "Connect my Telegram": 1) get a one-time code and the bot's name, 2) the person opens t.me/<bot>?start=<code>
-- and presses Start, 3) the dashboard keeps calling admin_telegram_check() until the bot has seen that message.
create or replace function public.admin_telegram_connect()
returns jsonb language plpgsql security definer set search_path = public as $$
declare c text := substr(md5(random()::text || clock_timestamp()::text), 1, 10); bot text; req bigint;
begin
  if not public.can('orders.view') then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'telegram_bot_token') then raise exception 'NO_TELEGRAM_BOT'; end if;
  delete from public.telegram_codes where user_id = auth.uid() or created_at < now() - interval '1 day';
  insert into public.telegram_codes (code, user_id) values (c, auth.uid());
  select nullif(username, '') into bot from public.telegram_bot where id = 1;
  if bot is null then req := public.telegram_call('getMe', '{}'::jsonb); end if;
  return jsonb_build_object('code', c, 'bot', bot, 'req', req);
end $$;

create or replace function public.admin_telegram_bot(p_req bigint)
returns text language plpgsql security definer set search_path = public as $$
declare r record; u text;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select status_code, content into r from net._http_response where id = p_req;
  if r.status_code = 200 then
    u := (r.content::jsonb)->'result'->>'username';
    if u is not null then
      insert into public.telegram_bot (id, username) values (1, u) on conflict (id) do update set username = excluded.username;
    end if;
  end if;
  return u;
end $$;

-- Reads the bot's new messages (the reply to the previous request, p_req), connects every chat that sent
-- "/start <code>" with a waiting code, then asks Telegram again. Returns {linked, title} or {req} to try again.
create or replace function public.admin_telegram_check(p_code text, p_req bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; upd jsonb; msg jsonb; m text[]; owner uuid; last_id bigint; mine jsonb; ttl text;
begin
  if not public.can('orders.view') then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.telegram_codes where code = p_code and user_id = auth.uid()) then
    -- already used: report the chat it connected
    select jsonb_build_object('linked', true, 'title', title) into mine from public.telegram_chats
      where user_id = auth.uid() order by created_at desc limit 1;
    return coalesce(mine, jsonb_build_object('expired', true));
  end if;
  if p_req is not null then
    select status_code, content into r from net._http_response where id = p_req;
    if r.status_code = 409 then return jsonb_build_object('error', 'webhook'); end if;
    if r.status_code = 200 then
      for upd in select * from jsonb_array_elements(coalesce((r.content::jsonb)->'result', '[]'::jsonb)) loop
        last_id := greatest(coalesce(last_id, 0), (upd->>'update_id')::bigint);
        msg := coalesce(upd->'message', upd->'channel_post');
        m := regexp_match(coalesce(msg->>'text', ''), '^/start(@[A-Za-z0-9_]+)?\s+([0-9a-f]{10})\s*$');
        if m is null then continue; end if;
        select user_id into owner from public.telegram_codes where code = m[2];
        if owner is null then continue; end if;
        ttl := coalesce(msg->'chat'->>'title', trim(concat_ws(' ', msg->'chat'->>'first_name', msg->'chat'->>'last_name')),
                        msg->'chat'->>'username', '');
        insert into public.telegram_chats (chat_id, title, kind, user_id)
        values (msg->'chat'->>'id', ttl, coalesce(msg->'chat'->>'type', 'private'), owner)
        on conflict (chat_id) do update set title = excluded.title, kind = excluded.kind, user_id = excluded.user_id;
        delete from public.telegram_codes where code = m[2];
        perform public.telegram_send_to(msg->'chat'->>'id', '✅ <b>ALLURE Boutique</b>' || E'\n' ||
          'Connected — you will get a message here for every new order.');
      end loop;
      if last_id is not null then
        perform public.telegram_call('getUpdates', jsonb_build_object('offset', last_id + 1, 'timeout', 0));   -- mark as read
      end if;
      if not exists (select 1 from public.telegram_codes where code = p_code) then
        select jsonb_build_object('linked', true, 'title', title) into mine from public.telegram_chats
          where user_id = auth.uid() order by created_at desc limit 1;
        return mine;
      end if;
    end if;
  end if;
  return jsonb_build_object('req', public.telegram_call('getUpdates',
    jsonb_build_object('timeout', 0, 'allowed_updates', jsonb_build_array('message', 'channel_post'))));
end $$;

create or replace function public.admin_telegram_remove(p_chat text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  delete from public.telegram_chats where chat_id = p_chat and (public.is_owner() or user_id = auth.uid());
  return found;
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
create policy settings_write on public.settings for update using (public.is_admin()) with check (public.is_admin());   -- which parts: settings_guard()

drop policy if exists products_read   on public.products;
drop policy if exists products_insert on public.products;
drop policy if exists products_update on public.products;
drop policy if exists products_delete on public.products;
create policy products_read   on public.products for select using (active or public.is_admin());
create policy products_insert on public.products for insert with check (public.can('products.edit'));
create policy products_update on public.products for update using (public.can('products.edit')) with check (public.can('products.edit'));
create policy products_delete on public.products for delete using (public.can('products.edit'));

drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_read   on public.profiles for select using (id = auth.uid() or public.can('customers.view'));
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists orders_read   on public.orders;
drop policy if exists orders_update on public.orders;
create policy orders_read   on public.orders for select using (user_id = auth.uid() or public.can('orders.view'));
create policy orders_update on public.orders for update using (public.can('orders.manage')) with check (public.can('orders.manage'));

drop policy if exists promo_admin on public.promo_codes;
create policy promo_admin on public.promo_codes for all using (public.can('promos.edit')) with check (public.can('promos.edit'));

drop policy if exists reviews_read   on public.reviews;
drop policy if exists reviews_insert on public.reviews;
drop policy if exists reviews_update on public.reviews;
drop policy if exists reviews_delete on public.reviews;
create policy reviews_read   on public.reviews for select using (approved or user_id = auth.uid() or public.can('reviews.manage'));
create policy reviews_insert on public.reviews for insert to authenticated
  with check (user_id = auth.uid() and approved = false
              and not exists (select 1 from public.profiles where id = auth.uid() and blocked));
create policy reviews_update on public.reviews for update using (public.can('reviews.manage')) with check (public.can('reviews.manage'));
create policy reviews_delete on public.reviews for delete using (public.can('reviews.manage'));

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
revoke execute on function public.telegram_send_to(text, text) from public, anon, authenticated;
revoke execute on function public.telegram_call(text, jsonb)   from public, anon, authenticated;
revoke execute on function public.telegram_targets()           from public, anon, authenticated;
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
  with check (bucket_id = 'product-images' and (public.can('products.edit') or public.can('settings.edit') or public.can('categories.edit')));
create policy product_images_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (public.can('products.edit') or public.can('settings.edit') or public.can('categories.edit')));
create policy product_images_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (public.can('products.edit') or public.can('settings.edit') or public.can('categories.edit')));

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
  if not public.can('insights.view') then raise exception 'FORBIDDEN'; end if;
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

-- ════════════════════════════════════════════════════════════════════════════
-- Owner tools: order edits / exchanges / returns / deletion, customers, blocking,
-- guest-order linking, review summary, order emails (Resend). Added October 2026.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.blocked_phones enable row level security;
drop policy if exists blocked_phones_admin on public.blocked_phones;
drop policy if exists blocked_phones_read on public.blocked_phones;
create policy blocked_phones_read  on public.blocked_phones for select using (public.can('customers.view'));
create policy blocked_phones_admin on public.blocked_phones for all using (public.can('customers.block')) with check (public.can('customers.block'));
revoke all on public.blocked_phones from anon;
grant select, insert, update, delete on public.blocked_phones to authenticated;   -- RLS limits this to admins

-- small helper: one order's pieces back into stock (+1) or out of stock (-1)
create or replace function public.order_stock(p_items jsonb, p_dir int)
returns void language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    update public.products set stock = greatest(stock + p_dir * (it->>'qty')::int, 0) where id = it->>'id';
  end loop;
end $$;

-- Edit an order (items, prices, customer, address, fees) or record an exchange.
-- p = {mode:'edit'|'exchange', note, customer:{...}, fulfil, city, address, delivery_fee, discount,
--      items:[{id, qty, unit, opts}]}. Stock follows the change in pieces.
create or replace function public.admin_edit_order(p_id bigint, p jsonb)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype; it jsonb; pr public.products%rowtype;
  items jsonb := '[]'::jsonb; sub int := 0; d record; mode text := coalesce(p->>'mode', 'edit');
  old_total int;
begin
  if not public.can('orders.edit') then raise exception 'FORBIDDEN'; end if;
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'NOT_FOUND:order'; end if;
  old_total := o.total;

  if p ? 'items' then
    if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'EMPTY_CART'; end if;
    for it in select * from jsonb_array_elements(p->'items') loop
      if coalesce((it->>'qty')::int, 0) < 1 then raise exception 'INVALID:qty'; end if;
      if coalesce((it->>'unit')::int, -1) < 0 then raise exception 'INVALID:price'; end if;
      select * into pr from public.products where id = it->>'id';
      items := items || jsonb_build_array(jsonb_build_object(
        'id', it->>'id', 'qty', (it->>'qty')::int, 'unit', (it->>'unit')::int, 'opts', coalesce(it->'opts', '{}'::jsonb),
        'name', coalesce(pr.name, it->>'name'), 'code', coalesce(pr.code, it->>'code'),
        'image', coalesce(pr.images[1], it->>'image'), 'bg', coalesce(pr.bg, it->>'bg')));
      sub := sub + (it->>'unit')::int * (it->>'qty')::int;
    end loop;
    -- stock follows the difference in pieces (only while the order still holds stock)
    if not o.restocked then
      for d in
        select k as pid, sum(q) as delta from (
          select x->>'id' k, (x->>'qty')::int q from jsonb_array_elements(items) x
          union all
          select x->>'id', -(x->>'qty')::int from jsonb_array_elements(o.items) x) z
        group by k having sum(q) <> 0
      loop
        if d.delta > 0 and exists (select 1 from public.products where id = d.pid and stock < d.delta) then
          raise exception 'OUT_OF_STOCK:%', (select name from public.products where id = d.pid);
        end if;
        update public.products set stock = greatest(stock - d.delta, 0) where id = d.pid;
      end loop;
    end if;
    o.items := items; o.subtotal := sub;
  end if;

  if p ? 'customer' then o.customer := o.customer || (p->'customer'); end if;
  if p ? 'fulfil' and p->>'fulfil' in ('delivery','pickup') then o.fulfil := p->>'fulfil'; end if;
  if p ? 'city' then o.city := nullif(p->>'city', ''); end if;
  if p ? 'address' then o.address := coalesce(p->>'address', ''); end if;
  if p ? 'delivery_fee' then o.delivery_fee := greatest(coalesce((p->>'delivery_fee')::int, 0), 0); end if;
  if p ? 'discount' then o.discount := greatest(coalesce((p->>'discount')::int, 0), 0); end if;
  if p ? 'payment' and p->>'payment' in ('cod','instapay') then o.payment := p->>'payment'; end if;
  if p ? 'customer_note' then o.note := left(coalesce(p->>'customer_note', ''), 1000); end if;
  if p ? 'customer' then
    o.customer := jsonb_set(o.customer, '{phone}', to_jsonb(public.norm_phone(o.customer->>'phone')));
    if o.customer->>'phone' !~ '^01[0125][0-9]{8}$' then raise exception 'INVALID:phone'; end if;
  end if;
  o.total := greatest(o.subtotal - o.discount + o.delivery_fee, 0);

  update public.orders set
    items = o.items, subtotal = o.subtotal, customer = o.customer, fulfil = o.fulfil, city = o.city, address = o.address,
    delivery_fee = o.delivery_fee, discount = o.discount, total = o.total, payment = o.payment, note = o.note,
    status = case when mode = 'exchange' then 'exchanged' else status end,
    changes = changes || jsonb_build_array(jsonb_build_object('at', now(), 'type', mode, 'note', coalesce(p->>'note', ''),
                'total_before', old_total, 'total_after', o.total))
  where id = p_id returning * into o;
  return o;
end $$;

-- Return / refund: money back (full or partial) and, if the pieces came back, return them to stock.
create or replace function public.admin_refund_order(p_id bigint, p_amount int, p_restock boolean, p_note text default '')
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  if not public.can('orders.refund') then raise exception 'FORBIDDEN'; end if;
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'NOT_FOUND:order'; end if;
  if coalesce(p_amount, 0) < 0 or o.refunded + coalesce(p_amount, 0) > o.total then raise exception 'INVALID:amount'; end if;
  if p_restock and not o.restocked then perform public.order_stock(o.items, 1); end if;
  update public.orders set
    refunded = refunded + coalesce(p_amount, 0),
    restocked = restocked or coalesce(p_restock, false),
    status = 'refunded',
    changes = changes || jsonb_build_array(jsonb_build_object('at', now(), 'type', 'refund', 'amount', coalesce(p_amount, 0),
                'restock', coalesce(p_restock, false), 'note', coalesce(p_note, '')))
  where id = p_id returning * into o;
  return o;
end $$;

-- Permanently remove an order (e.g. a test or spam order). Optionally returns its pieces to stock.
create or replace function public.admin_delete_order(p_id bigint, p_restock boolean)
returns text language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  if not public.can('orders.delete') then raise exception 'FORBIDDEN'; end if;
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'NOT_FOUND:order'; end if;
  if p_restock and not o.restocked then perform public.order_stock(o.items, 1); end if;
  delete from public.orders where id = p_id;
  return o.order_no;
end $$;

-- Customers: accounts with their order stats, guest buyers grouped by phone, and blocked numbers.
create or replace function public.admin_customers()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can('customers.view') then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'accounts', (select coalesce(jsonb_agg(t order by t.last_order desc nulls last, t.created_at desc), '[]'::jsonb) from (
      select p.id, p.name, p.email, p.phone, p.role, p.blocked, p.blocked_reason, p.blocked_at, p.created_at, p.staff_note,
             count(o.id) as orders,
             coalesce(sum(o.total - o.refunded) filter (where o.status not in ('cancelled')), 0) as spent,
             max(o.created_at) as last_order
      from public.profiles p left join public.orders o on o.user_id = p.id
      where p.role = 'customer'                                   -- the owner and staff are on the Team page
      group by p.id) t),
    'guests', (select coalesce(jsonb_agg(t order by t.last_order desc), '[]'::jsonb) from (
      select o.customer->>'phone' as phone,
             (array_agg(o.customer->>'name' order by o.created_at desc))[1] as name,
             (array_agg(o.customer->>'email' order by o.created_at desc))[1] as email,
             count(*) as orders,
             coalesce(sum(o.total - o.refunded) filter (where o.status not in ('cancelled')), 0) as spent,
             max(o.created_at) as last_order, min(o.created_at) as first_order,
             bool_or(exists (select 1 from public.blocked_phones b where b.phone = o.customer->>'phone')) as blocked
      from public.orders o where o.user_id is null group by o.customer->>'phone') t),
    'blocked_phones', (select coalesce(jsonb_agg(b order by b.created_at desc), '[]'::jsonb) from public.blocked_phones b));
end $$;

-- Edit a customer account: name, phone, internal note, block / unblock (blocking also blocks their phone number).
create or replace function public.admin_update_customer(p_id uuid, p jsonb)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare pr public.profiles%rowtype; was_blocked boolean; ph text;
begin
  select * into pr from public.profiles where id = p_id for update;
  if not found then raise exception 'NOT_FOUND:customer'; end if;
  if (p ? 'name' or p ? 'phone' or p ? 'staff_note') and not public.can('customers.edit') then raise exception 'FORBIDDEN'; end if;
  if (p ? 'blocked' or p ? 'blocked_reason') and not public.can('customers.block') then raise exception 'FORBIDDEN'; end if;
  if pr.role in ('owner','admin') and not public.is_owner() then raise exception 'FORBIDDEN'; end if;   -- staff are managed on the Team page
  was_blocked := pr.blocked;
  if (p->>'blocked')::boolean is true and (pr.role <> 'customer' or p_id = auth.uid()) then raise exception 'FORBIDDEN'; end if;
  ph := case when p ? 'phone' then public.norm_phone(p->>'phone') end;
  if ph is not null and ph <> '' and ph !~ '^01[0125][0-9]{8}$' then raise exception 'INVALID:phone'; end if;
  update public.profiles set
    name  = coalesce(nullif(trim(p->>'name'), ''), name),
    phone = coalesce(ph, phone),
    staff_note = case when p ? 'staff_note' then left(coalesce(p->>'staff_note', ''), 2000) else staff_note end,
    blocked = coalesce((p->>'blocked')::boolean, blocked),
    blocked_reason = case when p ? 'blocked_reason' then coalesce(p->>'blocked_reason', '') else blocked_reason end,
    blocked_at = case when coalesce((p->>'blocked')::boolean, blocked) and not was_blocked then now()
                      when not coalesce((p->>'blocked')::boolean, blocked) then null else blocked_at end
  where id = p_id returning * into pr;
  if pr.blocked and pr.phone <> '' then
    insert into public.blocked_phones (phone, reason) values (pr.phone, coalesce(nullif(pr.blocked_reason, ''), 'Account blocked'))
    on conflict (phone) do update set reason = excluded.reason;
  elsif was_blocked and not pr.blocked then
    delete from public.blocked_phones where phone = pr.phone;
  end if;
  return pr;
end $$;

create or replace function public.admin_block_phone(p_phone text, p_blocked boolean, p_reason text default '')
returns boolean language plpgsql security definer set search_path = public as $$
declare ph text := public.norm_phone(p_phone);
begin
  if not public.can('customers.block') then raise exception 'FORBIDDEN'; end if;
  if ph = '' then raise exception 'INVALID:phone'; end if;
  if p_blocked then
    insert into public.blocked_phones (phone, reason) values (ph, coalesce(p_reason, ''))
    on conflict (phone) do update set reason = excluded.reason;
  else
    delete from public.blocked_phones where phone = ph;
  end if;
  return p_blocked;
end $$;

-- Guest orders join an account automatically when the phone number matches (one account per phone).
-- Runs on its own: when an account is created or confirmed, when its phone changes, and when a guest
-- order comes in for a phone + email that already has an account. The shop also calls link_my_orders() at sign-in.
create or replace function public.link_orders_for(p_user uuid)
returns int language plpgsql security definer set search_path = public as $$
declare em text; confirmed timestamptz; ph text; n int;
begin
  select email, email_confirmed_at into em, confirmed from auth.users where id = p_user;
  if em is null or confirmed is null then return 0; end if;
  select phone into ph from public.profiles where id = p_user and role = 'customer';
  if coalesce(ph, '') = '' then return 0; end if;
  update public.orders set user_id = p_user,
         changes = changes || jsonb_build_array(jsonb_build_object('at', now(), 'type', 'linked', 'note', ''))
  where user_id is null and public.norm_phone(customer->>'phone') = ph;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.link_my_orders()
returns int language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return 0; end if;
  return public.link_orders_for(auth.uid());
end $$;

create or replace function public.profile_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.phone is distinct from old.phone then perform public.link_orders_for(new.id); end if;
  return null;
end $$;
drop trigger if exists profiles_link_orders on public.profiles;
create trigger profiles_link_orders after insert or update of phone on public.profiles
  for each row execute function public.profile_after_change();

create or replace function public.user_confirmed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then perform public.link_orders_for(new.id); end if;
  return null;
end $$;
drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users
  for each row execute function public.user_confirmed();

-- a guest order placed with the phone of an existing account goes straight into that account
create or replace function public.order_attach_account()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is null then
    select p.id into new.user_id from public.profiles p join auth.users u on u.id = p.id
    where p.role = 'customer' and p.phone <> '' and p.phone = public.norm_phone(new.customer->>'phone')
      and u.email_confirmed_at is not null
    limit 1;
  end if;
  return new;
end $$;
drop trigger if exists orders_attach_account on public.orders;
create trigger orders_attach_account before insert on public.orders for each row execute function public.order_attach_account();

-- The owner can attach a guest's orders (by phone) to an account by hand, e.g. when the email differs.
create or replace function public.admin_link_orders(p_user uuid, p_phone text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (public.can('customers.edit') and public.can('orders.edit')) then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.profiles where id = p_user and role = 'customer') then raise exception 'NOT_FOUND:customer'; end if;
  update public.orders set user_id = p_user,
         changes = changes || jsonb_build_array(jsonb_build_object('at', now(), 'type', 'linked', 'note', 'by staff'))
  where user_id is null and public.norm_phone(customer->>'phone') = public.norm_phone(p_phone);
  get diagnostics n = row_count;
  return n;
end $$;

-- Average rating and number of approved reviews (for the home page summary).
create or replace function public.review_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('average', round(coalesce(avg(rating), 0)::numeric, 1), 'count', count(*))
  from public.reviews where approved;
$$;

-- ─────────────────────────────── emails (Resend) ───────────────────────────────
-- API key lives in Vault as 'resend_api_key' (see SETUP.md). Sender details come from settings.email.

create or replace function public.send_email(p_to text, p_subject text, p_html text)
returns bigint language plpgsql security definer set search_path = public as $$
declare key text; s jsonb; sender text; rid bigint;
begin
  select decrypted_secret into key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  if key is null or coalesce(p_to, '') = '' then return null; end if;
  select coalesce(data->'mailer', '{}'::jsonb) into s from public.settings where id = 1;
  sender := coalesce(nullif(s->>'fromName', ''), 'ALLURE Boutique') || ' <' || coalesce(nullif(s->>'fromEmail', ''), 'onboarding@resend.dev') || '>';
  select net.http_post(
    url     := 'https://api.resend.com/emails',
    body    := jsonb_strip_nulls(jsonb_build_object('from', sender, 'to', jsonb_build_array(p_to), 'subject', p_subject,
                 'html', p_html, 'reply_to', nullif(s->>'replyTo', ''))),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key)
  ) into rid;
  return rid;
end $$;

create or replace function public.order_email_html(o public.orders)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  s jsonb; ar boolean := o.lang = 'ar'; site text; cur text; rows text := ''; it jsonb; opts text; pay text := '';
  fmt text; due int;
begin
  select data into s from public.settings where id = 1;
  site := rtrim(coalesce(nullif(s->>'siteUrl', ''), 'https://www.allure-boutique.org'), '/');
  cur := case when ar then ' ج.م' else ' LE' end;
  for it in select * from jsonb_array_elements(o.items) loop
    opts := concat_ws(' · ', it->'opts'->>'color', it->'opts'->>'letter', it->'opts'->>'ringSize', it->'opts'->>'bagSize',
              (select string_agg(x, ' + ') from jsonb_array_elements_text(coalesce(it->'opts'->'parts', '[]'::jsonb)) x));
    rows := rows || '<tr><td style="padding:12px 0;border-bottom:1px solid #e8e0d2;font-size:14px;color:#1d1a16">'
      || tg_esc(coalesce((select case when ar and name_ar <> '' then name_ar else name end from public.products where id = it->>'id'), it->>'name'))
      || case when opts <> '' then '<div style="font-size:12px;color:#8a7f70;margin-top:3px">' || tg_esc(opts) || '</div>' else '' end
      || '</td><td style="padding:12px 8px;border-bottom:1px solid #e8e0d2;font-size:13px;color:#6f665b;text-align:center">× ' || (it->>'qty')
      || '</td><td style="padding:12px 0;border-bottom:1px solid #e8e0d2;font-size:14px;color:#1d1a16;text-align:' || case when ar then 'left' else 'right' end || ';white-space:nowrap">'
      || to_char((it->>'unit')::int * (it->>'qty')::int, 'FM999,999,990') || cur || '</td></tr>';
  end loop;

  due := case when o.payment = 'instapay' then o.total when o.payment_status = 'awaiting' then o.delivery_fee else 0 end;
  if o.payment_status = 'awaiting' and due > 0 then
    pay := '<div style="background:#fbf6ea;border:1px solid #e3cf9f;padding:18px 20px;margin:22px 0;font-size:14px;line-height:1.7;color:#1d1a16">'
      || case when ar then 'من فضلك حوّل <b>' else 'Please send <b>' end || to_char(due, 'FM999,999,990') || cur || '</b> '
      || case when ar then 'عبر إنستاباي أو فودافون كاش إلى <b>' else 'via InstaPay or Vodafone Cash to <b>' end
      || tg_esc(coalesce(s->>'instapay', '')) || '</b>'
      || case when ar then '، ثم أرسل صورة التحويل على واتساب لتأكيد طلبك.' else ', then send the screenshot on WhatsApp to confirm your order.' end
      || case when coalesce(s->>'instapayLink', '') <> '' then '<div style="margin-top:14px"><a href="' || tg_esc(s->>'instapayLink') || '" style="display:inline-block;background:#1d1a16;color:#fffdf9;text-decoration:none;padding:11px 20px;font-size:13px;font-weight:bold">' || case when ar then 'الدفع عبر رابط إنستاباي' else 'Pay with the InstaPay link' end || '</a></div>' else '' end
      || case when coalesce(s->>'whatsapp', '') <> '' then '<div style="margin-top:10px"><a href="https://wa.me/' || tg_esc(s->>'whatsapp') || '" style="color:#9a7b3e;font-weight:bold">' || case when ar then 'افتح واتساب' else 'Open WhatsApp' end || ' ›</a></div>' else '' end
      || '</div>';
  end if;

  return '<!doctype html><html lang="' || o.lang || '" dir="' || case when ar then 'rtl' else 'ltr' end || '"><body style="margin:0;background:#f4f0e9;font-family:Helvetica,Arial,sans-serif">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f0e9"><tr><td align="center" style="padding:28px 12px">'
    || '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fffdf9;border:1px solid #e8e0d2" dir="' || case when ar then 'rtl' else 'ltr' end || '">'
    || '<tr><td align="center" style="padding:26px 24px 18px;border-bottom:1px solid #e8e0d2"><img src="' || site || '/assets/logo-light.png" alt="ALLURE Boutique" width="190" style="display:block;width:190px;max-width:70%;height:auto"></td></tr>'
    || '<tr><td style="padding:30px 32px 8px;text-align:' || case when ar then 'right' else 'left' end || '">'
    || '<div style="font-size:11px;letter-spacing:' || case when ar then '0' else '3px' end || ';color:#9a7b3e">' || case when ar then 'تأكيد الطلب' else 'ORDER CONFIRMATION' end || '</div>'
    || '<h1 style="font-family:Georgia,''Times New Roman'',serif;font-weight:normal;font-size:28px;color:#1d1a16;margin:10px 0 6px">'
    || case when ar then 'شكراً لك يا ' else 'Thank you, ' end || tg_esc(split_part(o.customer->>'name', ' ', 1)) || '</h1>'
    || '<p style="font-size:14px;line-height:1.7;color:#6f665b;margin:0">' || case when ar then 'استلمنا طلبك وهو الآن قيد المراجعة حتى نؤكده.' else 'We''ve received your order. It stays pending until we confirm it.' end || '</p>'
    || '<div style="margin:22px 0 4px;padding:16px 18px;border:1px dashed #b8964e;text-align:center"><div style="font-size:12px;color:#8a7f70">' || case when ar then 'رقم الطلب' else 'Your order number' end || '</div>'
    || '<div style="font-family:Georgia,serif;font-size:30px;color:#9a7b3e;letter-spacing:1px;margin-top:4px">' || o.order_no || '</div>'
    || '<div style="font-size:12px;color:#8a7f70;margin-top:6px">' || case when ar then 'احتفظ بهذا الرقم لتتبع طلبك' else 'Keep this number to track your order' end || '</div></div>'
    || pay
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px">' || rows || '</table>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;font-size:14px;color:#6f665b">'
    || '<tr><td style="padding:5px 0">' || case when ar then 'المجموع الفرعي' else 'Subtotal' end || '</td><td style="text-align:' || case when ar then 'left' else 'right' end || '">' || to_char(o.subtotal, 'FM999,999,990') || cur || '</td></tr>'
    || case when o.discount > 0 then '<tr><td style="padding:5px 0">' || case when ar then 'الخصم' else 'Discount' end || '</td><td style="text-align:' || case when ar then 'left' else 'right' end || '">−' || to_char(o.discount, 'FM999,999,990') || cur || '</td></tr>' else '' end
    || '<tr><td style="padding:5px 0">' || case when o.fulfil = 'pickup' then case when ar then 'استلام من الفرع' else 'Branch pickup' end else case when ar then 'التوصيل' else 'Delivery' end end || '</td><td style="text-align:' || case when ar then 'left' else 'right' end || '">'
    || case when o.delivery_fee > 0 then to_char(o.delivery_fee, 'FM999,999,990') || cur else case when ar then 'مجاناً' else 'Free' end end || '</td></tr>'
    || '<tr><td style="padding:12px 0 0;border-top:1px solid #e8e0d2;font-size:16px;color:#1d1a16"><b>' || case when ar then 'الإجمالي' else 'Total' end || '</b></td><td style="padding:12px 0 0;border-top:1px solid #e8e0d2;text-align:' || case when ar then 'left' else 'right' end || ';font-family:Georgia,serif;font-size:22px;color:#9a7b3e">' || to_char(o.total, 'FM999,999,990') || cur || '</td></tr></table>'
    || '<p style="font-size:13px;line-height:1.7;color:#6f665b;margin:22px 0 0">' || case when o.fulfil = 'pickup' then case when ar then 'الاستلام من: ' else 'Pickup from: ' end else case when ar then 'التوصيل إلى: ' else 'Delivering to: ' end end || tg_esc(o.address) || '</p>'
    || '<div style="text-align:center;margin:26px 0 30px"><a href="' || site || '/#/track/' || o.order_no || '" style="display:inline-block;background:#9a7b3e;color:#fffdf9;text-decoration:none;padding:14px 28px;font-size:13px;font-weight:bold;letter-spacing:' || case when ar then '0' else '2px' end || '">' || case when ar then 'تتبع طلبك' else 'TRACK YOUR ORDER' end || '</a></div>'
    || '</td></tr>'
    || '<tr><td style="padding:18px 24px;background:#f4f0e9;text-align:center;font-size:12px;line-height:1.7;color:#8a7f70">ALLURE Boutique · ' || tg_esc(case when ar and coalesce(s->>'address_ar', '') <> '' then s->>'address_ar' else coalesce(s->>'address', '') end)
    || case when coalesce(s->>'whatsapp', '') <> '' then '<br><a href="https://wa.me/' || tg_esc(s->>'whatsapp') || '" style="color:#9a7b3e">WhatsApp</a>' else '' end
    || '</td></tr></table></td></tr></table></body></html>';
end $$;

create or replace function public.order_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.customer->>'email', '') <> '' then
    perform public.send_email(new.customer->>'email',
      case when new.lang = 'ar' then 'تأكيد طلبك ' || new.order_no || ' — ألور بوتيك' else 'Your ALLURE order ' || new.order_no end,
      public.order_email_html(new));
  end if;
  return new;
exception when others then
  return new;   -- an email problem must never block an order
end $$;
drop trigger if exists orders_email on public.orders;
create trigger orders_email after insert on public.orders for each row execute function public.order_email();

create or replace function public.admin_email_status()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object('key', exists (select 1 from vault.decrypted_secrets where name = 'resend_api_key'));
end $$;

create or replace function public.admin_test_email(p_to text)
returns bigint language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  if not (public.can('settings.edit') and public.can('orders.view')) then raise exception 'FORBIDDEN'; end if;
  select * into o from public.orders order by created_at desc limit 1;
  if not found then
    o.order_no := 'AL00000'; o.lang := 'en'; o.customer := '{"name":"ALLURE Customer"}'; o.items := '[]';
    o.subtotal := 0; o.discount := 0; o.delivery_fee := 0; o.total := 0; o.fulfil := 'pickup'; o.address := ''; o.payment := 'cod'; o.payment_status := 'not_required';
  end if;
  return public.send_email(p_to, 'Test: ALLURE order email (' || o.order_no || ')', public.order_email_html(o));
end $$;

-- permissions for the new functions
revoke execute on function public.order_stock(jsonb, int)               from public, anon, authenticated;
revoke execute on function public.send_email(text, text, text)          from public, anon, authenticated;
revoke execute on function public.order_email()                         from public, anon, authenticated;
revoke execute on function public.order_email_html(public.orders)       from public, anon, authenticated;
revoke execute on function public.admin_edit_order(bigint, jsonb)       from public, anon;
revoke execute on function public.admin_refund_order(bigint, int, boolean, text) from public, anon;
revoke execute on function public.admin_delete_order(bigint, boolean)   from public, anon;
revoke execute on function public.admin_customers()                     from public, anon;
revoke execute on function public.admin_update_customer(uuid, jsonb)    from public, anon;
revoke execute on function public.admin_block_phone(text, boolean, text) from public, anon;
revoke execute on function public.admin_email_status()                  from public, anon;
revoke execute on function public.admin_test_email(text)                from public, anon;
revoke execute on function public.link_my_orders()                      from public, anon;
grant  execute on function public.admin_edit_order(bigint, jsonb)       to authenticated;
grant  execute on function public.admin_refund_order(bigint, int, boolean, text) to authenticated;
grant  execute on function public.admin_delete_order(bigint, boolean)   to authenticated;
grant  execute on function public.admin_customers()                     to authenticated;
grant  execute on function public.admin_update_customer(uuid, jsonb)    to authenticated;
grant  execute on function public.admin_block_phone(text, boolean, text) to authenticated;
grant  execute on function public.admin_email_status()                  to authenticated;
grant  execute on function public.admin_test_email(text)                to authenticated;
grant  execute on function public.link_my_orders()                      to authenticated;
grant  execute on function public.review_summary()                      to anon, authenticated;
grant  update (size_chart) on public.products to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- Team & permissions, activity log, saved addresses, one account per phone,
-- category editor, guest editing. Added October 2026.
-- ════════════════════════════════════════════════════════════════════════════

-- First run: the earliest admin becomes the main owner; other existing admins keep full access.
do $$
declare first_admin uuid;
begin
  if not exists (select 1 from public.profiles where role = 'owner') then
    select id into first_admin from public.profiles where role = 'admin' order by created_at limit 1;
    if first_admin is not null then
      update public.profiles set role = 'owner' where id = first_admin;
      update public.profiles set perms = array['orders.view','orders.manage','orders.edit','orders.refund','orders.delete',
        'customers.view','customers.edit','customers.block','products.edit','categories.edit','reviews.manage','pages.edit',
        'settings.edit','promos.edit','insights.view','export.data','activity.view']
      where role = 'admin' and perms = '{}';
    end if;
  end if;
end $$;

-- ───────────── one account per phone number ─────────────
update public.profiles p set phone = public.norm_phone(p.phone)
where p.phone <> public.norm_phone(p.phone)
  and not exists (select 1 from public.profiles q where q.id <> p.id and q.phone = public.norm_phone(p.phone));

create or replace function public.profile_phone_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.phone := public.norm_phone(new.phone);
  if new.phone <> '' and exists (select 1 from public.profiles where phone = new.phone and id <> new.id) then
    raise exception 'PHONE_TAKEN';
  end if;
  return new;
end $$;
drop trigger if exists profiles_phone_guard on public.profiles;
create trigger profiles_phone_guard before insert or update of phone on public.profiles
  for each row execute function public.profile_phone_guard();
do $$ begin
  create unique index if not exists profiles_phone_uniq on public.profiles(phone) where phone <> '';
exception when unique_violation then
  raise notice 'Some existing accounts share a phone number. New duplicates are blocked; the Customers page marks the existing ones.';
end $$;

-- sign-up form: is this number free? (true / false only)
create or replace function public.phone_available(p_phone text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where phone = public.norm_phone(p_phone) and public.norm_phone(p_phone) <> '');
$$;

-- ───────────── saved addresses ─────────────
create or replace function public.address_before_save()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.addresses where user_id = new.user_id) >= 10 then raise exception 'TOO_MANY_ADDRESSES'; end if;
    if not exists (select 1 from public.addresses where user_id = new.user_id) then new.is_default := true; end if;
  end if;
  if new.is_default then
    update public.addresses set is_default = false where user_id = new.user_id and id <> new.id and is_default;
  end if;
  return new;
end $$;
drop trigger if exists addresses_before_save on public.addresses;
create trigger addresses_before_save before insert or update on public.addresses
  for each row execute function public.address_before_save();

alter table public.addresses enable row level security;
drop policy if exists addresses_own on public.addresses;
drop policy if exists addresses_staff_read on public.addresses;
drop policy if exists addresses_staff_write on public.addresses;
create policy addresses_own on public.addresses for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy addresses_staff_read on public.addresses for select using (public.can('customers.view'));
create policy addresses_staff_write on public.addresses for all using (public.can('customers.edit')) with check (public.can('customers.edit'));
revoke all on public.addresses from anon;
grant select, insert, update, delete on public.addresses to authenticated;

-- ───────────── who may change which part of the settings ─────────────
create or replace function public.settings_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if auth.uid() is null or public.is_owner() then return new; end if;
  for k in select jsonb_object_keys(coalesce(old.data, '{}'::jsonb) || coalesce(new.data, '{}'::jsonb)) loop
    if (old.data->k) is distinct from (new.data->k)
       and not public.can(case k when 'pages' then 'pages.edit' when 'categories' then 'categories.edit' else 'settings.edit' end) then
      raise exception 'FORBIDDEN';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists settings_guard on public.settings;
create trigger settings_guard before update on public.settings for each row execute function public.settings_guard();

-- ───────────── activity log ─────────────
-- Every change made by the owner or staff is written here automatically, with what changed (before → after).
create or replace function public.log_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); nm text; o jsonb; n jsonb; r jsonb; d jsonb := '{}'::jsonb; k text; eid text; lbl text;
  skip text[] := array['updated_at','popularity','history','changes','restocked'];
begin
  if uid is null then return null; end if;
  select coalesce(nullif(name, ''), email) into nm from public.profiles where id = uid and role in ('owner','admin');
  if not found then return null; end if;                       -- customers' own actions aren't logged here
  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new); end if;
  r := coalesce(n, o);
  if tg_op = 'UPDATE' then
    if tg_table_name = 'settings' then
      for k in select jsonb_object_keys(coalesce(o->'data', '{}'::jsonb) || coalesce(n->'data', '{}'::jsonb)) loop
        if (o->'data'->k) is distinct from (n->'data'->k) then d := d || jsonb_build_object(k, jsonb_build_array(o->'data'->k, n->'data'->k)); end if;
      end loop;
    else
      for k in select jsonb_object_keys(n) loop
        if k <> all(skip) and (o->k) is distinct from (n->k) then d := d || jsonb_build_object(k, jsonb_build_array(o->k, n->k)); end if;
      end loop;
    end if;
    if d = '{}'::jsonb then return null; end if;
    -- stock moved by an order's status change is already explained by that order's entry
    if tg_table_name = 'products' and pg_trigger_depth() > 1 and (select array_agg(x) from jsonb_object_keys(d) x) = array['stock'] then return null; end if;
  elsif tg_op = 'DELETE' then d := jsonb_build_object('before', o);
  else d := jsonb_build_object('after', n);
  end if;
  eid := coalesce(r->>'order_no', r->>'code', r->>'chat_id', r->>'email', r->>'phone', r->>'id', '');
  if tg_table_name = 'products' then eid := r->>'id'; end if;
  if tg_table_name = 'addresses' then eid := r->>'user_id'; end if;
  if tg_table_name = 'blocked_phones' then eid := r->>'phone'; end if;
  if tg_table_name = 'settings' then eid := 'settings'; end if;
  lbl := case tg_table_name
    when 'orders' then r->'customer'->>'name'
    when 'products' then r->>'name'
    when 'profiles' then coalesce(nullif(r->>'name', ''), r->>'email')
    when 'reviews' then r->>'name'
    when 'addresses' then concat_ws(' · ', nullif(r->>'label', ''), r->>'city')
    when 'telegram_chats' then r->>'title'
    when 'staff_invites' then r->>'email'
    else '' end;
  insert into public.activity (actor, actor_name, action, entity, entity_id, label, details)
  values (uid, coalesce(nm, ''), lower(tg_op), tg_table_name, coalesce(eid, ''), coalesce(lbl, ''), d);
  return null;
end $$;

do $$
declare tb text;
begin
  foreach tb in array array['orders','products','settings','promo_codes','reviews','profiles','blocked_phones','addresses','staff_invites','telegram_chats'] loop
    execute format('drop trigger if exists %I on public.%I', tb || '_activity', tb);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.log_row_change()', tb || '_activity', tb);
  end loop;
end $$;

-- things that aren't row changes (signing in, exporting data)
create or replace function public.log_event(p_action text, p_label text default '', p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if p_action not in ('sign_in','export') then raise exception 'INVALID:action'; end if;
  select coalesce(nullif(name, ''), email) into nm from public.profiles where id = auth.uid() and role in ('owner','admin');
  if not found then return; end if;
  insert into public.activity (actor, actor_name, action, entity, label, details)
  values (auth.uid(), nm, p_action, 'dashboard', left(coalesce(p_label, ''), 200), coalesce(p_details, '{}'::jsonb));
  delete from public.activity where at < now() - interval '3 years';
end $$;

alter table public.activity enable row level security;
drop policy if exists activity_read on public.activity;
create policy activity_read on public.activity for select using (
  public.can('activity.view') or actor = auth.uid() or (entity = 'orders' and public.can('orders.view')));
revoke all on public.activity from anon, authenticated;
grant select on public.activity to authenticated;

-- ───────────── team (main owner only) ─────────────
create or replace function public.staff_perm_list()
returns text[] language sql immutable as $$
  select array['orders.view','orders.manage','orders.edit','orders.refund','orders.delete',
               'customers.view','customers.edit','customers.block','customers.delete','products.edit','categories.edit','reviews.manage',
               'pages.edit','settings.edit','promos.edit','insights.view','export.data','activity.view'];
$$;
-- keep only known permissions, and add what they depend on (e.g. editing orders needs seeing them)
create or replace function public.clean_perms(p text[])
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct x order by x), '{}') from (
    select x from unnest(coalesce(p, '{}')) x where x = any(public.staff_perm_list())
    union select 'orders.view' where exists (select 1 from unnest(coalesce(p, '{}')) y where y like 'orders.%' or y = 'export.data')
    union select 'customers.view' where exists (select 1 from unnest(coalesce(p, '{}')) y where y like 'customers.%' or y = 'export.data')
  ) z;
$$;

create or replace function public.admin_team()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'staff', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'email', p.email, 'phone', p.phone, 'role', p.role,
                'perms', p.perms, 'suspended', p.suspended, 'created_at', p.created_at, 'last_sign_in', u.last_sign_in_at,
                'confirmed', u.email_confirmed_at is not null) order by p.role desc, p.created_at), '[]'::jsonb)
              from public.profiles p join auth.users u on u.id = p.id where p.role in ('owner','admin')),
    'invites', (select coalesce(jsonb_agg(i order by i.created_at desc), '[]'::jsonb) from public.staff_invites i));
end $$;

-- Add a staff member by email. If they already have an account it becomes a staff account right away;
-- otherwise the dashboard creates the account and the invite is applied when it's saved.
create or replace function public.admin_invite_staff(p_email text, p_name text, p_perms text[])
returns text language plpgsql security definer set search_path = public as $$
declare em text := lower(trim(coalesce(p_email, ''))); pr public.profiles%rowtype;
begin
  if not public.is_owner() then raise exception 'FORBIDDEN'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID:email'; end if;
  select * into pr from public.profiles where lower(email) = em;
  if found then
    if pr.role = 'owner' then raise exception 'FORBIDDEN'; end if;
    if pr.blocked then raise exception 'BLOCKED'; end if;
    update public.profiles set role = 'admin', perms = public.clean_perms(p_perms), suspended = false,
           name = coalesce(nullif(name, ''), coalesce(p_name, '')) where id = pr.id;
    delete from public.staff_invites where email = em;
    return 'promoted';
  end if;
  insert into public.staff_invites (email, name, perms, invited_by) values (em, coalesce(p_name, ''), public.clean_perms(p_perms), auth.uid())
  on conflict (email) do update set name = excluded.name, perms = excluded.perms, invited_by = excluded.invited_by, created_at = now();
  return 'invited';
end $$;

create or replace function public.admin_update_staff(p_id uuid, p jsonb)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare pr public.profiles%rowtype;
begin
  if not public.is_owner() then raise exception 'FORBIDDEN'; end if;
  select * into pr from public.profiles where id = p_id for update;
  if not found or pr.role <> 'admin' then raise exception 'NOT_FOUND:staff'; end if;
  update public.profiles set
    perms = case when p ? 'perms' then public.clean_perms(array(select jsonb_array_elements_text(p->'perms'))) else perms end,
    suspended = coalesce((p->>'suspended')::boolean, suspended),
    name = coalesce(nullif(trim(p->>'name'), ''), name)
  where id = p_id returning * into pr;
  return pr;
end $$;

create or replace function public.admin_remove_staff(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'FORBIDDEN'; end if;
  update public.profiles set role = 'customer', perms = '{}', suspended = false where id = p_id and role = 'admin';
  delete from public.telegram_chats where user_id = p_id;
  return found;
end $$;

create or replace function public.admin_cancel_invite(p_email text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'FORBIDDEN'; end if;
  delete from public.staff_invites where email = lower(trim(p_email));
  return found;
end $$;

-- ───────────── categories editor ─────────────
-- p_cats: the full new list. p_moves: where products go when a name changes or a category / subcategory is removed:
-- [{cat, sub?, to_cat, to_sub?, keep_sub?}] (subcategory moves first, then whole categories).
create or replace function public.admin_save_categories(p_cats jsonb, p_moves jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare m jsonb; names text[]; bad text; n int := 0; c int;
begin
  if not public.can('categories.edit') then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_cats) <> 'array' or jsonb_array_length(p_cats) = 0 then raise exception 'INVALID:categories'; end if;
  select array_agg(trim(x->>'name')) into names from jsonb_array_elements(p_cats) x;
  if exists (select 1 from unnest(names) x where coalesce(x, '') = '') or (select count(distinct lower(x)) from unnest(names) x) <> array_length(names, 1)
    then raise exception 'INVALID:category_names'; end if;
  if exists (select 1 from jsonb_array_elements(p_cats) x
             where (select count(*) from jsonb_array_elements_text(coalesce(x->'subs', '[]'::jsonb)) s)
                <> (select count(distinct lower(trim(s))) from jsonb_array_elements_text(coalesce(x->'subs', '[]'::jsonb)) s where trim(s) <> ''))
    then raise exception 'INVALID:subcategory_names'; end if;

  for m in select x from jsonb_array_elements(coalesce(p_moves, '[]'::jsonb)) x order by (x->>'sub') is null loop
    update public.products set cat = m->>'to_cat',
           sub = case when (m->>'keep_sub')::boolean then sub else nullif(m->>'to_sub', '') end
    where cat = m->>'cat' and (m->>'sub' is null or sub = m->>'sub');
    get diagnostics c = row_count; n := n + c;
  end loop;

  select p.cat into bad from public.products p where not (p.cat = any(names)) limit 1;
  if bad is not null then raise exception 'CATEGORY_IN_USE:%', bad; end if;
  -- a subcategory that no longer exists: the product simply has none
  update public.products p set sub = null
  where p.sub is not null and not exists (select 1 from jsonb_array_elements(p_cats) x, jsonb_array_elements_text(coalesce(x->'subs', '[]'::jsonb)) s
                                          where x->>'name' = p.cat and s = p.sub);
  update public.settings set data = jsonb_set(data, '{categories}', p_cats) where id = 1;
  return n;
end $$;

-- ───────────── guests: correct the details on all their orders ─────────────
create or replace function public.admin_update_guest(p_phone text, p jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare ph text := public.norm_phone(p_phone); np text; n int; patch jsonb := '{}'::jsonb;
begin
  if not public.can('customers.edit') or not public.can('orders.edit') then raise exception 'FORBIDDEN'; end if;
  if p ? 'name' then
    if char_length(trim(p->>'name')) < 2 then raise exception 'INVALID:name'; end if;
    patch := patch || jsonb_build_object('name', trim(p->>'name'));
  end if;
  if p ? 'email' then
    if lower(trim(p->>'email')) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID:email'; end if;
    patch := patch || jsonb_build_object('email', lower(trim(p->>'email')));
  end if;
  if p ? 'phone' then
    np := public.norm_phone(p->>'phone');
    if np !~ '^01[0125][0-9]{8}$' then raise exception 'INVALID:phone'; end if;
    patch := patch || jsonb_build_object('phone', np);
  end if;
  update public.orders set customer = customer || patch where user_id is null and public.norm_phone(customer->>'phone') = ph;
  get diagnostics n = row_count;
  return n;
end $$;

-- ───────────── permissions for this section ─────────────
revoke execute on function public.log_row_change()                      from public, anon, authenticated;
revoke execute on function public.settings_guard()                      from public, anon, authenticated;
revoke execute on function public.profile_phone_guard()                 from public, anon, authenticated;
revoke execute on function public.address_before_save()                 from public, anon, authenticated;
revoke execute on function public.link_orders_for(uuid)                 from public, anon, authenticated;
revoke execute on function public.profile_after_change()                from public, anon, authenticated;
revoke execute on function public.user_confirmed()                      from public, anon, authenticated;
revoke execute on function public.order_attach_account()                from public, anon, authenticated;
revoke execute on function public.log_event(text, text, jsonb)          from public, anon;
revoke execute on function public.admin_team()                          from public, anon;
revoke execute on function public.admin_invite_staff(text, text, text[]) from public, anon;
revoke execute on function public.admin_update_staff(uuid, jsonb)       from public, anon;
revoke execute on function public.admin_remove_staff(uuid)              from public, anon;
revoke execute on function public.admin_cancel_invite(text)             from public, anon;
revoke execute on function public.admin_save_categories(jsonb, jsonb)   from public, anon;
revoke execute on function public.admin_update_guest(text, jsonb)       from public, anon;
revoke execute on function public.admin_link_orders(uuid, text)         from public, anon;
revoke execute on function public.admin_telegram_connect()              from public, anon;
revoke execute on function public.admin_telegram_bot(bigint)            from public, anon;
revoke execute on function public.admin_telegram_check(text, bigint)    from public, anon;
revoke execute on function public.admin_telegram_remove(text)           from public, anon;
grant  execute on function public.log_event(text, text, jsonb)          to authenticated;
grant  execute on function public.admin_team()                          to authenticated;
grant  execute on function public.admin_invite_staff(text, text, text[]) to authenticated;
grant  execute on function public.admin_update_staff(uuid, jsonb)       to authenticated;
grant  execute on function public.admin_remove_staff(uuid)              to authenticated;
grant  execute on function public.admin_cancel_invite(text)             to authenticated;
grant  execute on function public.admin_save_categories(jsonb, jsonb)   to authenticated;
grant  execute on function public.admin_update_guest(text, jsonb)       to authenticated;
grant  execute on function public.admin_link_orders(uuid, text)         to authenticated;
grant  execute on function public.admin_telegram_connect()              to authenticated;
grant  execute on function public.admin_telegram_bot(bigint)            to authenticated;
grant  execute on function public.admin_telegram_check(text, bigint)    to authenticated;
grant  execute on function public.admin_telegram_remove(text)           to authenticated;
grant  execute on function public.phone_available(text)                 to anon, authenticated;
grant  execute on function public.is_owner()                            to anon, authenticated;
grant  execute on function public.can(text)                             to anon, authenticated;
alter table public.staff_invites enable row level security;
alter table public.telegram_chats enable row level security;
alter table public.telegram_codes enable row level security;
alter table public.telegram_bot   enable row level security;
revoke all on public.staff_invites, public.telegram_chats, public.telegram_codes, public.telegram_bot from anon, authenticated;

-- ───────────── deleting accounts; one account per email ─────────────
-- Deletes the login and profile. Their orders stay (as guest orders) so sales history is kept;
-- their saved addresses, reviews and Telegram chats go with the account.
create or replace function public.admin_delete_user(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare pr public.profiles%rowtype;
begin
  select * into pr from public.profiles where id = p_id;
  if not found then raise exception 'NOT_FOUND:customer'; end if;
  if p_id = auth.uid() or pr.role = 'owner' then raise exception 'FORBIDDEN'; end if;
  if pr.role = 'admin' and not public.is_owner() then raise exception 'FORBIDDEN'; end if;
  if pr.role = 'customer' and not public.can('customers.delete') then raise exception 'FORBIDDEN'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner') then
    execute 'update storage.objects set owner = null where owner = $1' using p_id;   -- photos they uploaded stay
  end if;
  delete from public.profiles where id = p_id;                   -- logged in Activity with what was removed
  delete from auth.users where id = p_id;
  return true;
end $$;

-- sign-up form: is this email free? (an owner or staff email can never become a customer account)
create or replace function public.email_available(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from auth.users where lower(email) = lower(trim(coalesce(p_email, ''))))
     and not exists (select 1 from public.staff_invites where email = lower(trim(coalesce(p_email, ''))));
$$;

revoke execute on function public.admin_delete_user(uuid) from public, anon;
grant  execute on function public.admin_delete_user(uuid) to authenticated;
grant  execute on function public.email_available(text) to anon, authenticated;
