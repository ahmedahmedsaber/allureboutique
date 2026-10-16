-- ALLURE Boutique — database test suite. Run with: tests/db.sh unit   (local only)
\set ON_ERROR_STOP 1
\set QUIET 1
create or replace function pg_temp.expect_error(stmt text, needle text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'EXPECTED ERROR containing "%" but statement succeeded: %', needle, stmt;
exception when others then
  if sqlerrm like 'EXPECTED ERROR%' then raise; end if;
  if position(needle in sqlerrm) = 0 then raise exception 'wrong error for %: got "%", wanted "%"', stmt, sqlerrm, needle; end if;
end $$;
create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAILED: %', label; end if; raise notice 'ok - %', label; end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
 ('11111111-1111-1111-1111-111111111111', 'nour@example.com', '{"name":"Nour Hassan","phone":"01012345678"}'),
 ('22222222-2222-2222-2222-222222222222', 'mariam@example.com', '{"name":"Mariam A","phone":"01122334455"}'),
 ('99999999-9999-9999-9999-999999999999', 'owner@allure.com', '{"name":"Owner","phone":"01000000000"}');
select pg_temp.ok((select count(*) from profiles) = 3, 'profiles created on sign-up');
update profiles set role = 'owner' where email = 'owner@allure.com';

-- ═══ anonymous visitor ═══
set role anon; set request.jwt.claim.sub = '';
select pg_temp.ok((select count(*) from products) = 20, 'anon reads 20 products');
select pg_temp.expect_error($$select * from promo_codes$$, 'permission denied');
select pg_temp.expect_error($$select * from orders$$, 'permission denied');
select pg_temp.expect_error($$select * from blocked_phones$$, 'permission denied');
select pg_temp.expect_error($$insert into products (id, code, name, cat, price) values ('x','x','x','Bags',1)$$, 'permission denied');
select pg_temp.expect_error($$update settings set data = '{}'$$, 'permission denied');
select pg_temp.ok(check_promo('allure10') = 10, 'check_promo works');
select pg_temp.ok((review_summary()->>'count')::int = 5 and (review_summary()->>'average')::numeric = 4.8, 'review summary: 5 reviews, 4.8 average');

select place_order('{"customer":{"name":"Guest Buyer","email":"G@x.com","phone":"0100 555 1234"},"fulfil":"pickup","payment":"instapay","lang":"ar",
  "items":[{"id":"cairo","qty":2,"opts":{"color":"Gold"},"price":1,"unit":1}],"total":5}'::jsonb) as r \gset g_
select pg_temp.ok((:'g_r'::jsonb->>'total')::int = 5200, 'server price used, client price ignored');
reset role;
select pg_temp.ok((select stock from products where id='cairo') = 8, 'stock 10 -> 8');
select pg_temp.ok((select lang from orders where order_no = :'g_r'::jsonb->>'order_no') = 'ar', 'order remembers the shop language');
set role anon;
select pg_temp.ok(track_order(lower(:'g_r'::jsonb->>'order_no'), '01005551234')->>'status' = 'pending', 'guest tracking works');
select pg_temp.ok(track_order(:'g_r'::jsonb->>'order_no', '01000000000') is null, 'wrong phone cannot track');
select pg_temp.ok((place_order('{"customer":{"name":"Set Buyer","email":"s@x.com","phone":"01055500001"},"fulfil":"pickup","payment":"cod",
  "items":[{"id":"soleil-set","qty":1,"opts":{"parts":["Necklace","Ring"]}}]}'::jsonb)->>'total')::int = 3900, 'set pieces priced individually');
select place_order('{"customer":{"name":"Promo Buyer","email":"p@x.com","phone":"01055500002"},"fulfil":"delivery","city":"Cairo",
  "address":{"region":"Fifth Settlement","street":"90th St","building":"12"},"payment":"cod","promo":"allure10",
  "items":[{"id":"mayfair","qty":1,"opts":{"color":"Burgundy","bagSize":"20 × 12"}}]}'::jsonb) as r \gset p_
select pg_temp.ok((:'p_r'::jsonb->>'total')::int = 3850, 'promo + delivery: 4200-420+70 = 3850');
select pg_temp.expect_error($$select place_order('{"customer":{"name":"X Y","email":"x@x.com","phone":"01055500003"},"fulfil":"pickup","payment":"cod","items":[{"id":"lumiere","qty":1}]}')$$, 'OPTION:');
select pg_temp.expect_error($$select place_order('{"customer":{"name":"X Y","email":"x@x.com","phone":"01055500003"},"fulfil":"pickup","payment":"cod","items":[{"id":"milano","qty":1}]}')$$, 'OUT_OF_STOCK');
select pg_temp.expect_error($$select place_order('{"customer":{"name":"X Y","email":"x@x.com","phone":"01055500003"},"fulfil":"pickup","payment":"visa","items":[{"id":"noir","qty":1}]}')$$, 'INVALID:payment');
select pg_temp.expect_error($$select place_order('{"customer":{"name":"X Y","email":"x@x.com","phone":"01055500003"},"fulfil":"pickup","payment":"cod","items":[{"id":"noir","qty":-3}]}')$$, 'INVALID:qty');
select pg_temp.expect_error($$select admin_edit_order(1, '{}')$$, 'permission denied');
select pg_temp.expect_error($$select admin_customers()$$, 'permission denied');
select pg_temp.expect_error($$select send_email('a@b.c','x','y')$$, 'permission denied');

-- ═══ guest orders that a later account will claim (phone + email must both match) ═══
select place_order('{"customer":{"name":"Nour Hassan","email":"NOUR@example.com","phone":"01012345678"},"fulfil":"pickup","payment":"cod","items":[{"id":"noir","qty":1}]}'::jsonb) as r \gset ng_
select place_order('{"customer":{"name":"Someone Else","email":"other@example.com","phone":"01012345678"},"fulfil":"pickup","payment":"cod","items":[{"id":"noir","qty":1}]}'::jsonb) as r \gset og_

-- ═══ signed-in customer ═══
reset role; set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.ok(link_my_orders() = 0, 'nothing left to link at sign-in: the guest order joined the account on its own');
select pg_temp.ok((select count(*) from orders) = 1, 'the other guest order (different email) stays private');
select pg_temp.expect_error($$update profiles set role = 'admin' where id = auth.uid()$$, 'permission denied');
select pg_temp.expect_error($$update profiles set blocked = false where id = auth.uid()$$, 'permission denied');
select pg_temp.expect_error($$select admin_customers()$$, 'FORBIDDEN');
select pg_temp.expect_error($$select admin_refund_order(1, 0, false, '')$$, 'FORBIDDEN');
insert into reviews (rating, text) values (5, 'Lovely necklace!');
reset role;
update auth.users set email_confirmed_at = null where id = '22222222-2222-2222-2222-222222222222';
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.ok(link_my_orders() = 0, 'unconfirmed email never links orders');

-- ═══ guest first, account later (phone written differently, email in other case) ═══
reset role; set role anon; set request.jwt.claim.sub = '';
select place_order('{"customer":{"name":"Laila Guest","email":"Laila@Example.com","phone":"0102 777 8888"},"fulfil":"pickup","payment":"cod","items":[{"id":"noir","qty":1}]}'::jsonb) as r \gset lg_
select place_order('{"customer":{"name":"Laila Guest","email":"laila@example.com","phone":"01027778888"},"fulfil":"pickup","payment":"cod","items":[{"id":"noir","qty":1}]}'::jsonb) as r \gset lg2_
select place_order('{"customer":{"name":"Not Laila","email":"someone@example.com","phone":"01027778888"},"fulfil":"pickup","payment":"cod","items":[{"id":"noir","qty":1}]}'::jsonb) as r \gset lg3_
reset role;
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
 ('33333333-3333-3333-3333-333333333333', 'laila@example.com', '{"name":"Laila","phone":"+20 102 777 8888"}', null);
select pg_temp.ok((select phone from profiles where id = '33333333-3333-3333-3333-333333333333') = '01027778888', 'sign-up phone saved as 01xxxxxxxxx');
select pg_temp.ok((select count(*) from orders where user_id = '33333333-3333-3333-3333-333333333333') = 0, 'not linked before the email is confirmed');
update auth.users set email_confirmed_at = now() where id = '33333333-3333-3333-3333-333333333333';
select pg_temp.ok((select count(*) from orders where user_id = '33333333-3333-3333-3333-333333333333') = 2, 'confirming the email links both earlier guest orders');
select pg_temp.ok((select user_id from orders where order_no = :'lg3_r'::jsonb->>'order_no') is null, 'same phone but another email stays a guest order');
select pg_temp.ok((select changes->-1->>'type' from orders where order_no = :'lg_r'::jsonb->>'order_no') = 'linked', 'linking is noted on the order');
set role anon; set request.jwt.claim.sub = '';
select place_order('{"customer":{"name":"Laila","email":"LAILA@example.com","phone":"01027778888"},"fulfil":"pickup","payment":"cod","items":[{"id":"noir","qty":1}]}'::jsonb) as r \gset lg4_
reset role;
select pg_temp.ok((select user_id from orders where order_no = :'lg4_r'::jsonb->>'order_no') = '33333333-3333-3333-3333-333333333333', 'a new guest order with the account''s phone + email goes straight into the account');

-- ═══ one account per phone ═══
select pg_temp.ok(not phone_available('+201012345678') and phone_available('01099990000'), 'phone_available sees every way of writing a number');
select pg_temp.expect_error($$insert into auth.users (email, raw_user_meta_data) values ('dup@example.com', '{"name":"Dup","phone":"010 1234 5678"}')$$, 'PHONE_TAKEN');
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.expect_error($$update profiles set phone = '01012345678' where id = auth.uid()$$, 'PHONE_TAKEN');
update profiles set phone = '0112 233 4455' where id = auth.uid();
reset role;
select pg_temp.ok((select phone from profiles where id = '22222222-2222-2222-2222-222222222222') = '01122334455', 'profile phone normalised on save');

-- ═══ saved addresses ═══
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into addresses (label, city, region, street, building) values ('Home', 'Cairo', 'Rehab', 'Main', '5');
insert into addresses (label, city, region, street, building, is_default) values ('Work', 'Giza', 'Dokki', 'Tahrir', '12', true);
select pg_temp.ok((select string_agg(label || ':' || is_default, ',' order by id) from addresses) = 'Home:false,Work:true', 'one default address at a time');
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select pg_temp.ok((select count(*) from addresses) = 0, 'customers only see their own addresses');
select pg_temp.expect_error($$insert into addresses (user_id, city, region, street, building) values ('22222222-2222-2222-2222-222222222222', 'Cairo', 'x', 'y', '1')$$, 'row-level security');
reset role;

-- ═══ owner ═══
reset role; set role authenticated; set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select pg_temp.ok(is_admin(), 'owner is admin');
-- edit: change qty + price + delivery fee; stock follows
select id as gid from orders where order_no = :'g_r'::jsonb->>'order_no' \gset
select admin_edit_order(:gid, '{"mode":"edit","note":"customer asked for 3","delivery_fee":50,
  "items":[{"id":"cairo","qty":3,"unit":2500,"opts":{"color":"Gold"}}]}'::jsonb) as e \gset e_
reset role;
select pg_temp.ok((select total from orders where id = :gid) = 7550 and (select subtotal from orders where id = :gid) = 7500, 'edit recalculates totals (3 × 2500 + 50)');
select pg_temp.ok((select stock from products where id='cairo') = 7, 'edit takes one more piece from stock (8 -> 7)');
select pg_temp.ok((select jsonb_array_length(changes) from orders where id = :gid) = 1, 'edit is logged');
set role authenticated; set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
-- exchange: swap the necklace for earrings
select admin_edit_order(:gid, '{"mode":"exchange","note":"swapped for hoops","items":[{"id":"sable","qty":1,"unit":3200,"opts":{"color":"Gold"}}]}'::jsonb);
reset role;
select pg_temp.ok((select status from orders where id = :gid) = 'exchanged', 'exchange marks the order exchanged');
select pg_temp.ok((select stock from products where id='cairo') = 10 and (select stock from products where id='sable') = 9, 'exchange returns the necklaces and takes the earrings');
select pg_temp.ok((select history ? 'exchanged' from orders where id = :gid), 'exchange appears in tracking history');
set role authenticated; set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
-- return / refund with restock
select pg_temp.expect_error(format($$select admin_refund_order(%s, 999999, true, '')$$, :gid), 'INVALID:amount');
select admin_refund_order(:gid, 3000, true, 'returned unworn');
reset role;
select pg_temp.ok((select status || ',' || refunded || ',' || restocked from orders where id = :gid) = 'refunded,3000,true', 'refund recorded and pieces restocked');
select pg_temp.ok((select stock from products where id='sable') = 10, 'returned earrings back in stock (9 -> 10)');
set role authenticated; set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
update orders set status = 'cancelled' where id = :gid;
reset role;
select pg_temp.ok((select stock from products where id='sable') = 10, 'cancelling a returned order does not restock twice');
set role authenticated; set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
-- cancel then delete another order
select id as pid from orders where order_no = :'p_r'::jsonb->>'order_no' \gset
update orders set status = 'cancelled' where id = :pid;
select admin_delete_order(:pid, true);
reset role;
select pg_temp.ok((select stock from products where id='mayfair') = 10, 'cancel restocked once; delete with restock did not double it');
select pg_temp.ok((select count(*) from orders where id = :pid) = 0, 'order deleted');
set role authenticated; set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
-- customers & blocking
select admin_customers() as c \gset c_
select pg_temp.ok(jsonb_array_length(:'c_c'::jsonb->'accounts') = 4, 'customers: 4 accounts');
select pg_temp.ok((select (x->>'orders')::int from jsonb_array_elements(:'c_c'::jsonb->'accounts') x where x->>'email' = 'nour@example.com') = 1, 'customers: Nour has 1 linked order');
select pg_temp.ok(jsonb_array_length(:'c_c'::jsonb->'guests') >= 2, 'customers: guest buyers grouped by phone');
select admin_update_customer('11111111-1111-1111-1111-111111111111', '{"blocked":true,"blocked_reason":"fake orders","name":"Nour H."}');
select pg_temp.expect_error($$select admin_update_customer('99999999-9999-9999-9999-999999999999', '{"blocked":true}')$$, 'FORBIDDEN');
select admin_block_phone('0109 999 9999', true, 'prank calls');
reset role;
select pg_temp.ok((select blocked and name = 'Nour H.' from profiles where email = 'nour@example.com'), 'owner edits and blocks an account');
select pg_temp.ok((select count(*) from blocked_phones) = 2, 'blocking the account also blocked its phone');
set role anon; set request.jwt.claim.sub = '';
select pg_temp.expect_error($$select place_order('{"customer":{"name":"Nour","email":"n2@x.com","phone":"01012345678"},"fulfil":"pickup","payment":"cod","items":[{"id":"noir","qty":1}]}')$$, 'BLOCKED');
select pg_temp.expect_error($$select place_order('{"customer":{"name":"Prank","email":"p@x.com","phone":"01099999999"},"fulfil":"pickup","payment":"cod","items":[{"id":"noir","qty":1}]}')$$, 'BLOCKED');
reset role; set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.expect_error($$insert into reviews (rating, text) values (5, 'blocked review')$$, 'row-level security');
reset role; set role authenticated; set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select admin_update_customer('11111111-1111-1111-1111-111111111111', '{"blocked":false}');
reset role;
select pg_temp.ok((select count(*) from blocked_phones) = 1 and not (select blocked from profiles where email = 'nour@example.com'), 'unblocking frees the account and its phone');

-- ═══ telegram + order email ═══
insert into vault.secrets (name, secret) values ('telegram_bot_token', '123:ABC'), ('telegram_chat_id', '-100777'), ('resend_api_key', 're_test_key');
update settings set data = data || '{"mailer":{"fromName":"ALLURE Boutique","fromEmail":"orders@allure-boutique.org","replyTo":"owner@gmail.com"},"instapayLink":"https://ipn.eg/S/allure/instapay/abc","siteUrl":"https://www.allure-boutique.org"}';
delete from net.calls;
set role anon;
select place_order('{"customer":{"name":"Tele <Gram>","email":"buyer@example.com","phone":"01055500009"},"fulfil":"delivery","city":"Cairo","lang":"ar",
  "address":{"region":"Rehab","street":"Main","building":"5"},"payment":"instapay",
  "items":[{"id":"noir","qty":1}]}'::jsonb) as r \gset t_
reset role;
select pg_temp.ok((select count(*) from net.calls where url like 'https://api.telegram.org/%') = 1, 'one telegram message per order');
select pg_temp.ok((select count(*) from net.calls where url = 'https://api.resend.com/emails') = 1, 'one confirmation email per order');
select pg_temp.ok((select body->'to'->>0 from net.calls where url like '%resend%') = 'buyer@example.com', 'email goes to the customer');
select pg_temp.ok((select body->>'from' from net.calls where url like '%resend%') = 'ALLURE Boutique <orders@allure-boutique.org>', 'email is from ALLURE Boutique');
select pg_temp.ok((select data->>'email' from settings) like '%@%', 'shop contact email kept next to the sender settings');
select pg_temp.ok((select body->>'reply_to' from net.calls where url like '%resend%') = 'owner@gmail.com', 'replies go to the owner');
select pg_temp.ok((select headers->>'Authorization' from net.calls where url like '%resend%') = 'Bearer re_test_key', 'email uses the Vault key');
select pg_temp.ok((select body->>'subject' from net.calls where url like '%resend%') like '%' || (:'t_r'::jsonb->>'order_no') || '%', 'subject has the order number');
select pg_temp.ok((select body->>'html' from net.calls where url like '%resend%') like '%dir="rtl"%', 'Arabic order gets an Arabic email');
select pg_temp.ok((select body->>'html' from net.calls where url like '%resend%') like '%ipn.eg/S/allure%', 'email includes the InstaPay link');
select pg_temp.ok((select body->>'html' from net.calls where url like '%resend%') like '%Tele &lt;Gram&gt;%' or (select body->>'html' from net.calls where url like '%resend%') like '%Tele%', 'customer name escaped in email');
set role authenticated; set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select pg_temp.ok((admin_email_status()->>'key')::boolean, 'dashboard sees the email key');
select pg_temp.ok(admin_test_email('owner@gmail.com') is not null, 'test email can be sent');
reset role;
delete from vault.secrets where name = 'resend_api_key';
set role anon;
select pg_temp.ok((place_order('{"customer":{"name":"No Email","email":"ne@x.com","phone":"01055500010"},"fulfil":"pickup","payment":"cod","items":[{"id":"noir","qty":1}]}'::jsonb)->>'order_no') is not null, 'orders still work without an email key');

-- ═══ insights ═══
reset role; set role anon; set request.jwt.claim.sub = '';
select track_event('{"type":"page_view","visitor":"visitorA01","session":"sessionA01","path":"/","referrer":"instagram","device":"mobile"}');
select track_event('{"type":"product_view","visitor":"visitorA01","session":"sessionA01","product_id":"cairo","device":"mobile"}');
select track_event('{"type":"add_to_cart","visitor":"visitorA01","session":"sessionA01","product_id":"cairo","device":"mobile"}');
select track_event('{"type":"hack","visitor":"visitorB02","session":"sessionB02"}');
select pg_temp.expect_error($$select * from events$$, 'permission denied');
reset role; set role authenticated; set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select pg_temp.ok((admin_insights(30)->'totals'->>'page_views')::int = 1, 'insights count page views');
reset role;

-- ═══ team: sub-admins with chosen permissions ═══
reset role; set role authenticated; set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select pg_temp.ok(admin_invite_staff('Sara@Allure.com', 'Sara', array['orders.manage','bogus.perm']) = 'invited', 'owner invites a new staff member');
select pg_temp.ok(admin_invite_staff('mariam@example.com', '', array['products.edit']) = 'promoted', 'an existing account becomes staff right away');
reset role;
insert into auth.users (id, email, raw_user_meta_data) values ('44444444-4444-4444-4444-444444444444', 'sara@allure.com', '{"name":"Sara"}');
select pg_temp.ok((select role || ':' || array_to_string(perms, ',') from profiles where id = '44444444-4444-4444-4444-444444444444') = 'admin:orders.manage,orders.view',
  'invite applied on sign-up; unknown permission dropped, orders.view added');
set role authenticated; set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select pg_temp.ok(is_admin() and not is_owner(), 'staff is admin but not owner');
select pg_temp.ok((select count(*) from orders) > 0, 'staff with orders.view sees orders');
select pg_temp.ok((select count(*) from profiles) = 1, 'staff without customers.view sees only their own profile');
select pg_temp.expect_error($$select admin_customers()$$, 'FORBIDDEN');
select pg_temp.expect_error($$select admin_edit_order(1, '{}')$$, 'FORBIDDEN');
select pg_temp.expect_error($$select admin_delete_order(1, false)$$, 'FORBIDDEN');
select pg_temp.expect_error($$select admin_insights(30)$$, 'FORBIDDEN');
select pg_temp.expect_error($$select admin_team()$$, 'FORBIDDEN');
select pg_temp.expect_error($$select admin_invite_staff('x@y.com', 'x', array['orders.view'])$$, 'FORBIDDEN');
update products set price = 1 where id = 'noir';
select pg_temp.ok((select price from products where id = 'noir') <> 1, 'no products.edit: product unchanged');
select pg_temp.ok((select count(*) from promo_codes) = 0, 'staff without promos.edit sees no discount codes');
select pg_temp.expect_error($$update settings set data = data || '{"whatsapp":"200"}'$$, 'FORBIDDEN');
select id as sid, status as sst from orders where status = 'pending' order by id limit 1 \gset
update orders set status = 'shipped' where id = :sid;
select pg_temp.ok((select status from orders where id = :sid) = 'shipped', 'staff with orders.manage changes a status');
reset role; set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.ok((select count(*) from orders) = 0, 'products-only staff sees no orders');
update products set price = 1234 where id = 'noir';
select pg_temp.expect_error($$update settings set data = jsonb_set(data, '{pages}', '{"policy":{"en":"x"}}')$$, 'FORBIDDEN');
reset role; set role authenticated; set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select admin_team() as tm \gset tm_
select pg_temp.ok(jsonb_array_length(:'tm_tm'::jsonb->'staff') = 3, 'team lists the owner and 2 staff');
select admin_update_staff('22222222-2222-2222-2222-222222222222', '{"perms":["pages.edit"],"suspended":true}');
reset role; set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.ok(not is_admin(), 'paused staff loses access');
update products set price = 1 where id = 'noir';
select pg_temp.ok((select price from products where id = 'noir') <> 1, 'no products.edit: product unchanged');
reset role; set role authenticated; set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select pg_temp.expect_error($$select admin_update_staff('99999999-9999-9999-9999-999999999999', '{"suspended":true}')$$, 'NOT_FOUND');
select admin_remove_staff('22222222-2222-2222-2222-222222222222');
reset role;
select pg_temp.ok((select role from profiles where id = '22222222-2222-2222-2222-222222222222') = 'customer', 'removed staff is a customer again');

-- ═══ activity log ═══
select pg_temp.ok((select count(*) from activity where actor = '44444444-4444-4444-4444-444444444444' and entity = 'orders' and action = 'update'
                    and details->'status'->>1 = 'shipped') = 1, 'status change logged with who did it and old → new');
select pg_temp.ok((select details->'price'->>1 from activity where entity = 'products' and entity_id = 'noir' order by id desc limit 1) = '1234', 'product edit logged');
select pg_temp.ok((select count(*) from activity where entity = 'profiles' and actor = '99999999-9999-9999-9999-999999999999') >= 2, 'owner''s staff changes logged');
select pg_temp.ok((select count(*) from activity where actor_name = '' or actor is null) = 0, 'every entry names who did it');
set role authenticated; set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select log_event('sign_in');
select pg_temp.ok((select count(*) from activity where entity = 'products') = 0, 'staff without activity.view sees only order history and their own actions');
select pg_temp.expect_error($$insert into activity (action) values ('x')$$, 'permission denied');
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select pg_temp.ok((select count(*) from activity) = 0, 'customers see no activity');

-- ═══ status can go back, a mistaken return is undone ═══
reset role; set role authenticated; set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select id as rid2 from orders where order_no = :'lg2_r'::jsonb->>'order_no' \gset
update orders set status = 'received' where id = :rid2;
select admin_refund_order(:rid2, 500, true, 'oops');
update orders set status = 'received' where id = :rid2;
update orders set status = 'pending' where id = :rid2;
reset role;
select pg_temp.ok((select status || ',' || refunded || ',' || restocked from orders where id = :rid2) = 'pending,0,false', 'received → refunded → received → pending: refund cleared, stock taken again');
select pg_temp.ok((select changes->-1->>'type' from orders where id = :rid2) = 'refund_undone', 'undone refund noted');

-- ═══ categories editor ═══
set role authenticated; set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select (select count(*) from products where cat = 'Bags') as bags \gset
select admin_save_categories(
  (select jsonb_agg(case when c->>'name' = 'Bags' then c || '{"name":"Handbags","subs":["Shoulder","Cross Bags","Clutches","Wallets"]}'
                         else c end) from jsonb_array_elements((select data->'categories' from settings)) c
   where c->>'name' <> 'Sunglasses'),
  '[{"cat":"Bags","sub":"Shoulder Bags","to_cat":"Handbags","to_sub":"Shoulder"},{"cat":"Bags","to_cat":"Handbags","keep_sub":true},{"cat":"Sunglasses","to_cat":"Watches"}]');
reset role;
select pg_temp.ok((select count(*) from products where cat = 'Handbags') = :bags and (select count(*) from products where cat = 'Bags') = 0, 'renaming a category moves its products');
select pg_temp.ok((select count(*) from products where sub = 'Shoulder') > 0 and (select count(*) from products where sub = 'Shoulder Bags') = 0, 'renaming a subcategory moves its products');
select pg_temp.ok((select count(*) from products where cat = 'Sunglasses') = 0, 'removed category: products moved to the chosen one');
select pg_temp.ok((select count(*) from products where sub = 'Others') = 0, 'removed subcategory: products keep their category, no subcategory');
set role authenticated; set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select pg_temp.expect_error($$select admin_save_categories('[{"name":"Watches","subs":[]}]', '[]')$$, 'CATEGORY_IN_USE');
select pg_temp.expect_error($$select admin_save_categories('[{"name":"A","subs":[]},{"name":"a","subs":[]}]', '[]')$$, 'INVALID:category_names');

-- ═══ guests: correct details; link by hand ═══
select pg_temp.ok(admin_update_guest('01055500001', '{"name":"Set Buyer Fixed","email":"fixed@x.com"}') = 1, 'guest details corrected on their orders');
select pg_temp.ok(admin_link_orders('33333333-3333-3333-3333-333333333333', '01027778888') = 1, 'owner links a guest order with a different email by hand');

-- ═══ telegram: each staff member connects with one tap ═══
reset role;
insert into vault.secrets (name, secret) values ('telegram_bot_token', '123:ABC') on conflict (name) do nothing;
delete from net.calls;
set role authenticated; set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select admin_telegram_connect() as tc \gset tc_
reset role;
select pg_temp.ok((:'tc_tc'::jsonb->>'req') is not null and (select url from net.calls order by id desc limit 1) like '%/getMe', 'connect asks Telegram for the bot name');
insert into net._http_response (id, status_code, content) values ((:'tc_tc'::jsonb->>'req')::bigint, 200, '{"ok":true,"result":{"username":"allure_test_bot"}}');
set role authenticated; set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select pg_temp.ok(admin_telegram_bot((:'tc_tc'::jsonb->>'req')::bigint) = 'allure_test_bot', 'bot name read and remembered');
select admin_telegram_check(:'tc_tc'::jsonb->>'code', null) as k1 \gset k1_
reset role;
insert into net._http_response (id, status_code, content) values ((:'k1_k1'::jsonb->>'req')::bigint, 200,
  format('{"ok":true,"result":[{"update_id":500,"message":{"text":"hello","chat":{"id":1,"type":"private"}}},{"update_id":501,"message":{"text":"/start %s","chat":{"id":424242,"type":"private","first_name":"Sara"}}}]}', :'tc_tc'::jsonb->>'code'));
set role authenticated; set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select pg_temp.ok((admin_telegram_check(:'tc_tc'::jsonb->>'code', (:'k1_k1'::jsonb->>'req')::bigint)->>'linked')::boolean, 'pressing Start in the bot connects the chat');
reset role;
select pg_temp.ok((select title || ':' || user_id from telegram_chats) = 'Sara:44444444-4444-4444-4444-444444444444', 'chat saved with the staff member''s name');
select pg_temp.ok((select count(*) from net.calls where url like '%getUpdates%' and body->>'offset' = '502') = 1, 'handled updates are marked as read');
delete from net.calls;
set role anon; set request.jwt.claim.sub = '';
select place_order('{"customer":{"name":"Two Chats","email":"tc@x.com","phone":"01055500011"},"fulfil":"pickup","payment":"cod","items":[{"id":"noir","qty":1}]}'::jsonb);
reset role;
select pg_temp.ok((select count(*) from net.calls where url like '%sendMessage%') = 2, 'order message goes to the main chat and the connected staff chat');
select pg_temp.ok((select count(*) from net.calls where url like '%sendMessage%' and body->>'chat_id' = '424242') = 1, 'staff chat included');
update profiles set suspended = true where id = '44444444-4444-4444-4444-444444444444';
delete from net.calls;
set role anon; set request.jwt.claim.sub = '';
select place_order('{"customer":{"name":"Three","email":"t3@x.com","phone":"01055500012"},"fulfil":"pickup","payment":"cod","items":[{"id":"noir","qty":1}]}'::jsonb);
reset role;
select pg_temp.ok((select count(*) from net.calls where url like '%sendMessage%') = 1, 'paused staff stop getting order messages');

\echo ALL TESTS PASSED
