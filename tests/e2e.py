"""End-to-end test: shop + dashboard in Chrome against the local stand-in (tests/gateway.py + PostgREST + Postgres).
Usage: python3 tests/e2e.py <gateway-output-file> [width]      Screenshots go to $SHOTS (default /tmp/allure-shots)."""
import json, os, subprocess, sys
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8000/'
KEY = [l.split('=', 1)[1].strip() for l in open(sys.argv[1]) if l.startswith('ANON_KEY=')][0]
CONFIG = f"window.ALLURE_CONFIG = {{ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: '{KEY}' }};"
W = int(sys.argv[2]) if len(sys.argv) > 2 else 1280
tag = 'd' if W > 800 else 'm'
SHOTS = os.environ.get('SHOTS', '/tmp/allure-shots'); os.makedirs(SHOTS, exist_ok=True)
def psql(q): return subprocess.run(['psql', '-h', '127.0.0.1', '-p', '54329', '-U', 'postgres', '-d', 'allure', '-At', '-c', q], capture_output=True, text=True, check=True).stdout.strip()
def ok(c, label):
    print(('ok   - ' if c else 'FAIL - ') + label, flush=True)
    if not c: raise SystemExit(1)

# test pictures
from PIL import Image, ImageDraw
IMG = os.path.join(SHOTS, 'test-photo.jpg'); CHART = os.path.join(SHOTS, 'test-chart.png')
im = Image.new('RGB', (1500, 2000), (236, 226, 206)); d = ImageDraw.Draw(im)
for i in range(9): d.ellipse((450 + i * 60 - 70, 800, 450 + i * 60 + 70, 940), fill=(250, 248, 240), outline=(200, 180, 140), width=6)
im.save(IMG, quality=90)
ch = Image.new('RGB', (1200, 600), 'white'); d = ImageDraw.Draw(ch)
for r in range(5): d.line((0, r * 120, 1200, r * 120), fill='black', width=3)
ch.save(CHART)

psql("""update settings set data = data || '{"instapayLink":"https://ipn.eg/S/allure/instapay/test","siteUrl":"https://www.allure-boutique.org"}'""")

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    def ctx():
        c = b.new_context(viewport={'width': W, 'height': 900}, accept_downloads=True)
        c.route('**/config.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=CONFIG))
        c.route('**/realtime/v1/**', lambda r: r.abort())
        return c
    errs = []
    def page(c):
        pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); return pg
    def shot(pg, n, full=True): pg.wait_for_timeout(500); pg.screenshot(path=f'{SHOTS}/{tag}_{n}.png', full_page=full)
    def nav(pg, name):
        if W <= 820: pg.click('[data-act=side]'); pg.wait_for_timeout(350)
        pg.click('.adm-nav >> text=' + name)

    # ── guest checkout ──
    c1 = ctx(); pg = page(c1)
    pg.goto(BASE); pg.wait_for_selector('.card')
    ok(pg.locator('#waFloat').is_visible(), 'WhatsApp button shown')
    ok('wa.me/201001111111' in pg.locator('#waFloat').get_attribute('href'), 'WhatsApp button opens the store chat')
    ok(pg.locator('.rev-summary').count() == 1 and '4.8' in pg.locator('.rev-summary').inner_text(), 'average rating summary shown (4.8)')
    ok('VALUE MALL' in pg.locator('.hero, .marquee').first.inner_text().upper() or 'Value Mall' in pg.content(), 'Value Mall wording')
    pg.goto(BASE + '#/product/cairo'); pg.wait_for_selector('.pdp-h1')
    pg.click('[data-act=opt][data-k=color][data-v=Gold]'); pg.click('[data-act=qty][data-d="1"]'); pg.click('[data-act=addCart]')
    pg.goto(BASE + '#/checkout'); pg.wait_for_selector('#co-name')
    pg.fill('#co-name', 'Nour Hassan'); pg.fill('#co-email', 'nour@example.com'); pg.fill('#co-phone', '01012345678')
    pg.click('[data-act=coFulfil][data-v=pickup]'); pg.click('[data-act=coNext][data-n="1"]')
    pg.click('[data-act=coPay][data-v=instapay]'); pg.click('[data-act=coNext][data-n="2"]')
    pg.click('[data-act=placeOrder]'); pg.wait_for_selector('.confirm'); shot(pg, '01_confirmation')
    no1 = pg.locator('.confirm .eyebrow').inner_text().split()[-1]
    ok('screenshot' in pg.locator('.shot-note').inner_text().lower() and no1 in pg.locator('.shot-note').inner_text(), 'confirmation asks for a screenshot of the order number')
    ok(pg.locator('a[href="https://ipn.eg/S/allure/instapay/test"]').count() == 1, 'InstaPay link button shown')
    ok(psql(f"select total from orders where order_no='{no1}'") == '5200', 'guest order placed (5,200)')
    ok(psql("select count(*) from net.calls where url = 'https://api.resend.com/emails'") == '0', 'no email without a Resend key (order still fine)')

    # ── account: links the earlier guest order (same phone + email) ──
    pg.goto(BASE + '#/account'); pg.click('[data-act=authMode][data-m=signup]')
    pg.fill('#au-name', 'Nour Hassan'); pg.fill('#au-phone', '01012345678'); pg.fill('#au-email', 'nour@example.com'); pg.fill('#au-password', 'secret123')
    pg.click('form[data-form=auth] button[type=submit]'); pg.wait_for_selector('.acct-cover h1')
    pg.wait_for_timeout(1200)
    ok(psql(f"select user_id is not null from orders where order_no='{no1}'") == 't', 'guest order linked to the new account')
    pg.goto(BASE + '#/orders'); pg.wait_for_selector('.order')
    ok(no1 in pg.locator('.narrow').inner_text(), 'linked order listed in My Orders')
    pg.goto(BASE + '#/product/mayfair'); pg.wait_for_selector('.pdp-h1')
    pg.click('[data-act=opt][data-k=color][data-v=Burgundy]'); pg.click('[data-act=opt][data-k=bagSize] >> nth=0'); pg.click('[data-act=addCart]')
    pg.goto(BASE + '#/checkout'); pg.wait_for_selector('#co-name')
    pg.select_option('#co-city', 'Cairo'); pg.fill('#co-region', 'Fifth Settlement'); pg.fill('#co-street', '90th St'); pg.fill('#co-building', '12')
    pg.click('[data-act=coNext][data-n="1"]'); pg.click('[data-act=coPay][data-v=cod]'); pg.click('[data-act=coNext][data-n="2"]')
    pg.click('[data-act=placeOrder]'); pg.wait_for_selector('.confirm')
    no2 = pg.locator('.confirm .eyebrow').inner_text().split()[-1]
    ok(psql(f"select total from orders where order_no='{no2}'") == '4270', 'account order placed (4,200 + 70)')
    pg.wait_for_timeout(800)
    ok(psql("select count(*) || ':' || bool_and(is_default) from addresses") == '1:true', 'new delivery address saved to the account (default)')
    pg.goto(BASE + '#/product/noir'); pg.wait_for_selector('.pdp-h1'); pg.click('[data-act=addCart]')
    pg.goto(BASE + '#/checkout'); pg.wait_for_selector('#co-name')
    ok(pg.locator('.addr-pick [data-act=coAddr]').count() == 2 and pg.locator('#co-street').count() == 0, 'checkout offers the saved address (plus "use a new address")')
    shot(pg, '01b_saved_address', False)
    pg.goto(BASE + '#/addresses'); pg.wait_for_selector('.addr-card')
    ok('90th St' in pg.locator('.addr-card').inner_text(), 'Addresses tab lists the saved address')
    c1.close()

    # ── owner dashboard ──
    c2 = ctx(); pg = page(c2)
    pg.goto(BASE + '#/account'); pg.click('[data-act=authMode][data-m=signup]')
    pg.fill('#au-name', 'Owner'); pg.fill('#au-phone', '01000000000'); pg.fill('#au-email', 'owner@allure.com'); pg.fill('#au-password', 'owner123')
    pg.click('form[data-form=auth] button[type=submit]'); pg.wait_for_selector('.acct-cover h1')
    psql("update profiles set role='owner' where email='owner@allure.com'")
    pg.goto(BASE + 'admin.html'); pg.wait_for_selector('.adm-nav'); pg.wait_for_selector('#revChart svg, #revChart .chart-empty')

    # edit order: 2 → 3 necklaces at 2,500 each + 50 delivery
    nav(pg, 'ORDERS'); pg.wait_for_selector('.atbl')
    pg.click('.tabs2 >> text=All'); pg.click(f'tr[data-no="{no1}"]'); pg.wait_for_selector('.opage')
    ok(f'#/order/{no1}' in pg.url, 'order opens on its own page')
    pg.click('[data-act=oform][data-f=edit]'); pg.wait_for_selector('.oedit')
    pg.fill('[data-oi="0"][data-k=qty]', '3'); pg.fill('[data-oi="0"][data-k=unit]', '2500'); pg.fill('[data-oe=delivery_fee]', '50'); pg.fill('[data-oe=note]', 'customer asked for 3')
    ok('7,550' in pg.locator('#oeTotal').inner_text(), 'editor shows the new total live')
    shot(pg, '02_edit_order', False)
    pg.click('[data-act=doEdit]'); pg.wait_for_timeout(900)
    ok(psql(f"select total || ',' || jsonb_array_length(changes) from orders where order_no='{no1}'") == '7550,2', 'order edited and logged (after the “linked to account” note)')
    ok(psql("select stock from products where id='cairo'") == '7', 'edit took one more necklace from stock')
    # exchange: necklaces → hoops
    pg.click('[data-act=oform][data-f=exchange]'); pg.wait_for_selector('.oedit')
    pg.select_option('[data-oi="0"][data-k=id]', 'sable'); pg.wait_for_timeout(300)
    pg.fill('[data-oi="0"][data-k=qty]', '1'); pg.select_option('[data-oi="0"][data-k=color]', 'Gold'); pg.fill('[data-oe=note]', 'swapped for hoops')
    pg.click('[data-act=doEdit]'); pg.wait_for_timeout(900)
    ok(psql(f"select status from orders where order_no='{no1}'") == 'exchanged', 'exchange recorded')
    ok(psql("select stock from products where id='cairo'") == '10' and psql("select stock from products where id='sable'") == '9', 'exchange moved stock both ways')
    # return / refund
    pg.click('[data-act=oform][data-f=refund]'); pg.fill('#rf-amount', '3000'); pg.fill('#rf-note', 'returned unworn')
    pg.click('[data-act=doRefund]'); pg.wait_for_timeout(900); shot(pg, '03_after_refund', False)
    ok(psql(f"select status || ',' || refunded from orders where order_no='{no1}'") == 'refunded,3000', 'return / refund recorded')
    ok(psql("select stock from products where id='sable'") == '10', 'returned piece back in stock')
    ok(pg.locator('.log-row').count() == 4, 'change log lists linking, edit, exchange and refund')
    pg.wait_for_selector('.act-list .act-row'); shot(pg, '03b_order_page')
    ok(pg.locator('.act-list .act-row').count() >= 3 and 'Owner' in pg.locator('.act-list').inner_text(), 'order page shows who did what')
    pg.goto(BASE + f'admin.html#/order/{no2}'); pg.wait_for_selector('.opage')
    pg.click('[data-act=setStatus][data-s=received]'); pg.wait_for_timeout(700)
    pg.click('[data-act=setStatus][data-s=shipped]'); pg.wait_for_timeout(700)
    ok(psql(f"select status from orders where order_no='{no2}'") == 'shipped', 'a received order can be moved back to shipped')
    # delete a test order
    pg.click('[data-act=oform][data-f=delete]'); pg.click('[data-act=doDelete]'); pg.wait_for_timeout(900)
    ok(pg.url.endswith('#/orders'), 'after deleting, back to the orders list')
    ok(psql(f"select count(*) from orders where order_no='{no2}'") == '0', 'order deleted')
    ok(psql("select stock from products where id='mayfair'") == '10', 'deleted order’s piece returned to stock')

    # customers: block the account (and its phone)
    nav(pg, 'CUSTOMERS'); pg.wait_for_selector('.tiles'); shot(pg, '04_customers')
    ok(pg.locator('tr[data-act=openCust] >> text=owner@allure.com').count() == 0, 'staff accounts are not listed as customers')
    pg.click('tr[data-act=openCust] >> nth=0'); pg.wait_for_selector('#custSpend')
    ok('#/customer/u' in pg.url, 'customer opens on its own page'); pg.wait_for_timeout(400); shot(pg, '04b_customer_page')
    ok(pg.locator('#custSpend svg').count() == 1, 'customer spending chart drawn')
    pg.click('.tabs2 >> text=Addresses'); pg.wait_for_selector('.addr')
    ok('90th St' in pg.locator('.addr-grid').inner_text(), 'team sees the customer saved addresses')
    pg.click('.tabs2 >> text=Details & blocking'); pg.wait_for_selector('#ce-note')
    pg.fill('#ce-note', 'VIP - loves pearls'); pg.click('form[data-form=custEdit] button[type=submit]'); pg.wait_for_timeout(700)
    ok(psql("select staff_note from profiles where email='nour@example.com'") == 'VIP - loves pearls', 'team note saved on the customer')
    pg.fill('#cb-reason', 'test block'); pg.click('[data-act=blockAcc]'); pg.wait_for_timeout(900)
    ok(psql("select blocked from profiles where email='nour@example.com'") == 't' and psql("select count(*) from blocked_phones where phone='01012345678'") == '1', 'account and phone blocked')

    # product: photo (cropped) + size chart
    nav(pg, 'PRODUCTS'); pg.wait_for_selector('.atbl'); pg.click('text=+ ADD PRODUCT'); pg.wait_for_selector('#pe-name')
    pg.fill('#pe-name', 'Luna Pearl Bracelet'); pg.fill('#pe-code', '111'); pg.select_option('#pe-cat', 'Jewelry'); pg.select_option('#pe-sub', 'Bracelets')
    pg.fill('#pe-stock', '5'); pg.fill('#pe-price', '1800'); pg.fill('#pe-nameAr', 'سوار لونا اللؤلؤ')
    pg.set_input_files('#pe-files', IMG); pg.wait_for_selector('.crop-box .cropper-container'); shot(pg, '05_crop', False)
    pg.click('[data-crop=ok]'); pg.wait_for_selector('.photo-item')
    pg.set_input_files('#pe-chart', CHART); pg.wait_for_selector('.crop-box'); pg.click('[data-crop=orig]'); pg.wait_for_selector('.chart-prev')
    pg.click('form[data-form=product] button[type=submit]'); pg.wait_for_timeout(1200)
    ok(psql("select array_length(images,1) || ',' || (size_chart <> '') from products where code='111'") == '1,true', 'product saved with cropped photo and size chart')
    from PIL import Image as _I
    stored = [os.path.join(dp, f) for dp, _, fs in os.walk(os.environ.get('GATEWAY_STORAGE', '/tmp/allure-test-storage')) for f in fs if 'size-chart' not in dp]
    newest = max(stored, key=os.path.getmtime); w, h = _I.open(newest).size
    ok(abs(w / h - 0.75) < 0.02, f'uploaded product photo cropped to 3:4 ({w}×{h})')

    # pages: custom policy text
    nav(pg, 'PAGES'); pg.wait_for_selector('[data-page=en]')
    pg.fill('[data-page=en]', '## Our promise\nEvery **ALLURE** piece is checked twice.\n- Exchanges within 14 days')
    pg.click('[data-act=savePages]'); pg.wait_for_timeout(800)
    ok('Our promise' in psql("select data->'pages'->'policy'->>'en' from settings"), 'policy page saved')

    # settings: reviews summary off
    nav(pg, 'SETTINGS'); pg.wait_for_selector('[data-set="reviews.showAverage"]')
    pg.uncheck('[data-set="reviews.showAverage"]')
    pg.fill('[data-set="mailer.fromName"]', 'ALLURE Boutique'); pg.fill('[data-set="mailer.fromEmail"]', 'orders@allure-boutique.org')
    pg.fill('[data-set="mailer.replyTo"]', 'owner@gmail.com'); pg.fill('[data-set="instapayLink"]', 'https://ipn.eg/S/allure/instapay/ui')
    pg.click('form[data-form=settings] button[type=submit]'); pg.wait_for_timeout(800)
    ok(psql("select data->'reviews'->>'showAverage' || ',' || coalesce(data->'reviews'->>'showCount', 'true') from settings") == 'false,true', 'average switched off, count still on')
    ok(psql("select data->'mailer'->>'fromEmail' from settings") == 'orders@allure-boutique.org'
       and psql("select data->>'email' from settings") == 'hello@allureboutique.com'
       and psql("select data->>'instapayLink' from settings").endswith('/ui'), 'email sender saved, shop contact email kept')

    # export
    nav(pg, 'EXPORT'); pg.wait_for_selector('[data-act=doExport]'); pg.click('[data-act=exPreset][data-k=all]')
    with pg.expect_download() as dl: pg.click('[data-act=doExport]')
    path = dl.value.path(); size = os.path.getsize(path)
    import zipfile
    names = zipfile.ZipFile(path).namelist()
    ok(size > 3000 and sum(1 for n in names if n.startswith('xl/worksheets/sheet')) == 5, f'Excel export downloaded with 5 sheets ({size} bytes)')
    shot(pg, '06_export')

    # notifications: email card
    nav(pg, 'NOTIFICATIONS'); pg.wait_for_selector('[data-form=testEmail]')
    psql("insert into vault.secrets (name, secret) values ('resend_api_key', 're_test') on conflict (name) do nothing")
    pg.reload(); pg.wait_for_selector('[data-form=testEmail]'); pg.wait_for_timeout(800)
    pg.fill('#te-to', 'owner@gmail.com'); pg.click('form[data-form=testEmail] button[type=submit]'); pg.wait_for_timeout(600)
    ok(psql("select count(*) from net.calls where url = 'https://api.resend.com/emails'") == '1', 'test email sent through Resend')

    # categories: rename a subcategory, products follow
    nav(pg, 'CATEGORIES'); pg.wait_for_selector('.cat-ed')
    others = pg.locator('.cat-ed').nth(1).locator('[data-k=name][data-sub]').last
    ok(others.input_value() == 'Others', 'categories page lists subcategories')
    others.fill('Other bags'); pg.click('[data-act=catSave]'); pg.wait_for_timeout(1000)
    ok(psql("select count(*) from products where sub = 'Others'") == '0' and int(psql("select count(*) from products where sub = 'Other bags'")) > 0, 'renamed subcategory: products moved with it')
    ok('Other bags' in psql("select data->'categories'->1->>'subs' from settings"), 'category list saved')
    shot(pg, '06b_categories')

    # team: add a staff member who can only handle orders
    nav(pg, 'TEAM'); pg.wait_for_selector('form[data-form=staffAdd]')
    pg.click('[data-act=permPreset][data-scope=new] >> nth=0')
    pg.fill('#ns-name', 'Sara'); pg.fill('#ns-email', 'sara@allure.com'); pg.fill('#ns-pw', 'sara1234')
    pg.click('form[data-form=staffAdd] button[type=submit]'); pg.wait_for_selector('.staff >> text=sara@allure.com')
    ok(psql("select role || ':' || array_to_string(perms, ',') from profiles where email='sara@allure.com'") == 'admin:customers.view,orders.manage,orders.view', 'staff account created with the chosen access')
    ok(pg.locator('.adm-nav >> text=TEAM').count() == 1, 'owner still signed in as owner (creating the staff login did not switch accounts)')
    shot(pg, '06c_team')

    # telegram: connect with one tap
    psql("insert into vault.secrets (name, secret) values ('telegram_bot_token', '123:ABC') on conflict (name) do nothing")
    pg.goto(BASE + 'admin.html#/notifications'); pg.reload(); pg.wait_for_selector('[data-act=tgConnect]')
    pg.click('[data-act=tgConnect]'); pg.wait_for_timeout(500)
    rq = psql("select id from net.calls where url like '%/getMe' order by id desc limit 1")
    psql(f"""insert into net._http_response (id, status_code, content) values ({rq}, 200, '{{"ok":true,"result":{{"username":"allure_test_bot"}}}}')""")
    pg.wait_for_selector('a[href*="t.me/allure_test_bot?start="]')
    code = pg.locator('a[href*="?start="]').get_attribute('href').split('start=')[1]
    import time as _t
    g = ''
    for _ in range(30):
        g = psql("select id from net.calls where url like '%/getUpdates' order by id desc limit 1")
        if g: break
        _t.sleep(0.5)
    psql(f"""insert into net._http_response (id, status_code, content) values ({g}, 200, '{{"ok":true,"result":[{{"update_id":7,"message":{{"text":"/start {code}","chat":{{"id":555,"type":"private","first_name":"Owner"}}}}}}]}}')""")
    pg.wait_for_selector('text=Connected: Owner', timeout=15000)
    ok(psql("select title from telegram_chats where chat_id='555'") == 'Owner', 'Telegram connected by pressing Start')
    shot(pg, '06d_telegram', False)

    if W <= 820:
        pg.click('[data-act=side]'); pg.wait_for_timeout(350)
        so = pg.locator('.adm-side [data-act=signOut]'); so.scroll_into_view_if_needed()
        bx = so.bounding_box()
        ok(bx is not None and bx['y'] + bx['height'] <= 900, 'phone menu scrolls so SIGN OUT is reachable')
        shot(pg, '06e_menu', False)
        pg.keyboard.press('Escape')

    # staff signs in: sees only what they're allowed, and their changes are recorded
    c4 = ctx(); st = page(c4)
    st.goto(BASE + 'admin.html'); st.wait_for_selector('#lg-email')
    st.fill('#lg-email', 'sara@allure.com'); st.fill('#lg-pw', 'sara1234'); st.click('form[data-form=login] button[type=submit]')
    st.wait_for_selector('.adm-nav')
    navs = st.locator('.adm-nav button').all_inner_texts()
    ok(any('ORDERS' in x for x in navs) and not any(('SETTINGS' in x) or ('TEAM' in x) or ('PRODUCTS' in x) for x in navs), 'staff menu shows only allowed pages: ' + ', '.join(x.split(chr(10))[0] for x in navs))
    st.goto(BASE + 'admin.html#/settings'); st.wait_for_timeout(600)
    ok('No access' in st.locator('.adm-main').inner_text(), 'staff cannot open Settings by typing the address')
    st.goto(BASE + 'admin.html#/orders/all'); st.wait_for_selector('.atbl')
    st.locator('tr[data-act=openOrder]').first.click(); st.wait_for_selector('.opage')
    sno = st.url.split('/order/')[1]
    ok(st.locator('[data-act=oform]').count() == 0, 'staff without edit access sees no edit / refund / delete buttons')
    st.locator('[data-act=setStatus]').first.click(); st.wait_for_timeout(800)
    c4.close()
    nav(pg, 'ACTIVITY'); pg.wait_for_selector('.act-row')
    ok('Sara' in pg.locator('.act-list').inner_text() and sno in pg.locator('.act-list').inner_text(), 'activity log shows what the staff member did')
    ok('signed in' in pg.locator('.act-list').inner_text(), 'sign-ins are logged')
    shot(pg, '06f_activity')
    pg.goto(BASE + 'admin.html#/notifications'); pg.wait_for_selector('[data-form=testEmail]')
    ok('Bot setup' not in pg.content() and 'ONE-TIME SETUP' not in pg.content(), 'no setup guides on the Notifications page')
    nav(pg, 'INSIGHTS'); pg.wait_for_selector('.share-row')
    ok('?utm_source=instagram' in pg.locator('.share-row').first.inner_text(), 'Insights offers ready-made share links')
    # delete a customer account: orders stay as guest orders
    nid = psql("select id from profiles where email='nour@example.com'")
    pg.goto(BASE + f'admin.html#/customer/u%3A{nid}/details'); pg.wait_for_selector('[data-act=userDeleteAsk]')
    pg.click('[data-act=userDeleteAsk]'); pg.click('[data-act=userDelete]'); pg.wait_for_timeout(1000)
    ok(psql("select count(*) from auth.users where email='nour@example.com'") == '0' and psql(f"select count(*) from orders where order_no='{no1}' and user_id is null") == '1', 'customer account deleted, their order kept as a guest order')

    # ── shop reflects it all (fresh customer browser) ──
    c3 = ctx(); s = page(c3)
    s.goto(BASE + '#/page/policy'); s.wait_for_selector('.prose h2')
    ok(s.locator('.prose h2').first.inner_text() == 'Our promise' and s.locator('.prose b').first.inner_text() == 'ALLURE', 'shop shows the edited policy page')
    s.goto(BASE); s.wait_for_selector('.card'); s.wait_for_timeout(600)
    ok(s.locator('.rev-summary .avg').count() == 0 and 'reviews' in s.locator('.rev-summary').inner_text(), 'shop hides the average but still shows the number of reviews')
    s.goto(BASE + '#/product/luna-pearl-bracelet-111'); s.wait_for_selector('.pdp-h1')
    s.click('[data-act=sizeChart]'); s.wait_for_selector('#lightbox:not([hidden]) img')
    ok(s.locator('#lightbox img').evaluate('i => i.naturalWidth') > 0, 'size chart opens on the product page'); shot(s, '07_size_chart', False)
    s.click('[data-act=lbClose]')
    # tagged links are counted as the source and removed from the address bar
    s.goto(BASE + '?utm_source=instagram'); s.wait_for_selector('.card'); s.wait_for_timeout(1500)
    ok('utm_source' not in s.url, 'tag removed from the address bar')
    ok(psql("select count(*) from events where referrer = 'instagram'") == '1', 'visit from ?utm_source=instagram recorded as Instagram')
    s.goto(BASE + '#/?utm_source=tiktok'); s.reload(); s.wait_for_selector('.card'); s.wait_for_timeout(1500)
    ok(psql("select count(*) from events where referrer = 'tiktok'") == '1' and s.locator('.card').count() > 0, 'tag pasted after the # still works (and the page still opens)')
    # one account per email (including the owner's)
    s.goto(BASE + '#/account'); s.click('[data-act=authMode][data-m=signup]')
    s.fill('#au-name', 'Fake Owner'); s.fill('#au-phone', '01099991111'); s.fill('#au-email', 'OWNER@allure.com'); s.fill('#au-password', 'secret123')
    s.click('form[data-form=auth] button[type=submit]'); s.wait_for_selector('form[data-form=auth] .form-err')
    ok('already exists' in s.locator('form[data-form=auth] .form-err').inner_text(), 'cannot make a customer account with the owner email')
    # one account per phone number
    s.goto(BASE + '#/account'); s.click('[data-act=authMode][data-m=signup]')
    psql("update profiles set phone = '01027770000' where email = 'sara@allure.com'")
    s.fill('#au-name', 'Copy Cat'); s.fill('#au-phone', '0102 777 0000'); s.fill('#au-email', 'copy@example.com'); s.fill('#au-password', 'secret123')
    s.click('form[data-form=auth] button[type=submit]'); s.wait_for_selector('form[data-form=auth] .form-err')
    s.wait_for_function("document.querySelector('form[data-form=auth] .form-err').textContent.includes('another account')")
    ok('already belongs to another account' in s.locator('form[data-form=auth] .form-err').inner_text(), 'sign-up refuses a phone number that another account uses')
    ok(psql("select count(*) from auth.users where email='copy@example.com'") == '0', 'no duplicate account created')
    s.goto(BASE + '#/product/luna-pearl-bracelet-111'); s.wait_for_selector('.pdp-h1')
    # blocked phone can't order
    s.click('[data-act=addCart]'); s.goto(BASE + '#/checkout'); s.wait_for_selector('#co-name')
    s.fill('#co-name', 'Blocked Person'); s.fill('#co-email', 'b@example.com'); s.fill('#co-phone', '01012345678')
    s.click('[data-act=coFulfil][data-v=pickup]'); s.click('[data-act=coNext][data-n="1"]'); s.click('[data-act=coPay][data-v=cod]'); s.click('[data-act=coNext][data-n="2"]')
    s.click('[data-act=placeOrder]'); s.wait_for_selector('.co-side .form-err')
    ok('WhatsApp' in s.locator('.co-side .form-err').inner_text(), 'blocked phone gets the “contact us on WhatsApp” message')
    # Arabic email for an Arabic order
    s.fill('#co-phone', '01055500077') if s.locator('#co-phone').count() else None
    s.click('[data-act=coStep][data-n="1"]'); s.fill('#co-phone', '01055500077'); s.click('[data-act=coNext][data-n="1"]'); s.click('[data-act=coNext][data-n="2"]')
    s.click('.hdr [data-act=lang]'); s.wait_for_timeout(300)
    s.click('[data-act=placeOrder]'); s.wait_for_selector('.confirm')
    ok(psql("select body->>'html' like '%dir=\"rtl\"%' from net.calls where url like '%resend%' order by id desc limit 1") == 't', 'Arabic order gets an Arabic confirmation email')
    shot(s, '08_confirm_ar')

    print('page errors:', errs)
    ok(not errs, 'no page errors')
    b.close()
print('ALL E2E CHECKS PASSED')
