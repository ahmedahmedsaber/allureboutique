# ALLURE Boutique: going live

The shop runs on **Supabase**, which holds the database, customer logins and product photos. The website itself is just files, so it can be hosted anywhere. Setup takes about 30 minutes and is only done once. Supabase's free plan is enough to start.

| What | Where |
|---|---|
| The shop | `index.html` |
| Owner dashboard | `admin.html` (add `/admin.html` to your shop's address) |
| Connection settings | `config.js` |
| Database setup files | `supabase/schema.sql`, `supabase/seed.sql`, `supabase/arabic.sql` |
| Hosting (Railway) | `Dockerfile`, `Caddyfile`, `railway.json` |

---

## 1. Create the Supabase project

1. Sign up at **supabase.com** and click **New project**.
   - **Name:** `allure-boutique`.
   - **Region:** **Frankfurt (eu-central-1)**, the closest to Egypt.
   - **Database password:** save it somewhere safe.
2. When the project is ready, open **Project Settings → API** (on newer dashboards, **Project Settings → API Keys**) and copy two values:
   - **Project URL**, e.g. `https://abcdefgh.supabase.co`
   - **anon public** key (a long text that starts with `eyJ…`). The newer **publishable** key (`sb_publishable_…`) also works.
3. Paste both into `config.js`:

   ```js
   window.ALLURE_CONFIG = {
     SUPABASE_URL: 'https://abcdefgh.supabase.co',
     SUPABASE_ANON_KEY: 'eyJ…',
   };
   ```

   Both values are meant to be public. The database's security rules control what each visitor can see or change.
   **Never** put the `service_role` / secret key in any website file.

## 2. Create the database

1. In Supabase, open **SQL Editor → New query**.
2. Open `supabase/schema.sql`, copy all of it, paste it into the editor and click **Run**. It should end with "Success. No rows returned".
3. Do the same with `supabase/seed.sql`. This loads the starting products, the store settings and the `ALLURE10` discount code.

You can run `schema.sql` again later, for example after an update. It keeps all your data. **Run it again whenever the site is updated with new database features**, such as Insights or Arabic.

**Already set up before the Arabic version?** Run the latest `schema.sql` (it adds the Arabic fields), then run `supabase/arabic.sql`. That fills in the Arabic names and descriptions for the starter products, categories, banner and cities. It only fills fields that are still empty, so anything you've edited stays as it is, and it's safe to run twice.

## 3. Customer logins

1. In **Authentication → URL Configuration**:
   - **Site URL:** `https://www.allure-boutique.org`
   - **Redirect URLs:** add both `https://www.allure-boutique.org/**` and `https://allure-boutique.org/**`

   **This fixes "localhost" in confirmation emails.** When the shop's address isn't on the Redirect URLs list, Supabase falls back to the Site URL. If that is still `http://localhost:3000`, every link in the email points to localhost.
2. In **Authentication → Sign In / Providers → Email**, choose how sign-up works:
   - **Confirm email ON** (recommended): customers click a link in an email before they can sign in.
   - **Confirm email OFF**: customers are signed in straight away.

Guests can always check out without an account. They track their order with the order number and their phone number on the **Track an Order** page.

**Earlier guest orders join the account automatically.** When a customer creates an account, the shop finds their earlier guest orders and adds them to **My Orders**. The phone number **and** the email must both match, and the email must be confirmed, so nobody can claim someone else's orders with just a phone number.

## 3b. Emails from "ALLURE Boutique" (Resend, free)

Two kinds of email go to customers:
- **Account emails** (confirm sign-up, reset password) are sent by Supabase.
- **Order confirmations** (order number, items, total, InstaPay details, tracking link) are sent by the database the moment an order is placed, in the language the customer was using.

Both go through **Resend** (resend.com). Its free plan covers 3,000 emails a month and 100 a day. You don't need a mailbox at allure-boutique.org: emails are *sent from* `orders@allure-boutique.org`, and when a customer presses Reply, the reply goes to your Gmail.

**A. Verify your domain in Resend (about 10 minutes, once)**
1. Sign up at **resend.com**, open **Domains → Add domain**, type `allure-boutique.org`, and choose region **Ireland (eu-west-1)**.
2. Resend shows 3 DNS records: an MX record and a TXT record on `send`, and a TXT record on `resend._domainkey`. In **GoDaddy → My Products → allure-boutique.org → DNS → Add New Record**, add each one exactly as shown. In GoDaddy's **Name** box, leave out `.allure-boutique.org`, so type only `send` or `resend._domainkey`.
3. Back in Resend, press **Verify**. It usually turns green within 5–30 minutes.

**B. Order confirmation emails**
1. In Resend, open **API Keys → Create API key** (permission: *Sending access*) and copy the key (`re_…`).
2. In Supabase **SQL Editor**, run:

   ```sql
   select vault.create_secret('re_YOUR_KEY', 'resend_api_key');
   ```

   To change it later: `select vault.update_secret((select id from vault.secrets where name = 'resend_api_key'), 're_NEW_KEY');`
3. In the dashboard **Settings → Emails to customers**, set:
   - **Sender name:** `ALLURE Boutique`
   - **Sender address:** `orders@allure-boutique.org`
   - **Replies go to:** your Gmail address

   Also set **Shop address (used in emails)**, in **Payment & contact**, to `https://www.allure-boutique.org` (it's used for the logo and the "Track your order" button), then **Save**.
4. In **Notifications → Email — order confirmations**, check that the Resend key shows **Saved**, then send a test email to yourself.

**C. Account emails with your name and design**
1. In Supabase **Authentication → Emails → SMTP Settings**, turn on **Custom SMTP** and fill in:

   | Field | Value |
   |---|---|
   | Sender email | `noreply@allure-boutique.org` |
   | Sender name | `ALLURE Boutique` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | your Resend API key (`re_…`) |

   From now on, emails come from "ALLURE Boutique" and not from Supabase. Supabase's own rate limit is also lifted.
2. In **Authentication → Emails → Templates**, replace each template with the files in the `emails/` folder. Open each file, copy all of it, and paste it into the **Source** box:

   | Template | File | Subject |
   |---|---|---|
   | Confirm signup | `emails/confirm-signup.html` | `Confirm your ALLURE account · أكدي حسابك` |
   | Reset password | `emails/reset-password.html` | `Reset your ALLURE password · إعادة تعيين كلمة المرور` |
   | Change email address | `emails/change-email.html` | `Confirm your new email · أكدي بريدك الجديد` |
   | Magic link | `emails/magic-link.html` | `Your ALLURE sign-in link · رابط الدخول` |

   Each email shows English on top and Arabic below, with the ALLURE logo and colours.

## 4. Make yourself the owner

1. Open the shop, go to **My Account → Create account** and sign up with the email you'll use to manage the shop.
2. In Supabase **SQL Editor**, run this with your email:

   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```

3. Open **`admin.html`** and sign in with the same email and password.

To add a partner or staff member, they create an account and you run the same line with their email. To remove their access, run it again with `'customer'` in place of `'admin'`.

## 5. Order notifications

### Telegram: a message on your phone for every order

This is free and works even when the dashboard is closed.

1. In Telegram, open **@BotFather**, send `/newbot`, and pick a name such as "ALLURE Orders". BotFather replies with a **token** like `123456789:AAH…`.
2. Open your new bot and press **Start**.
   - **For a whole team:** create a Telegram group, add the bot to it, and send any message in the group.
3. In a browser, open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`. Find `"chat":{"id":` and copy the number after it. That is your **chat ID**. Group IDs start with `-`.
4. In Supabase **SQL Editor**, run this with your values:

   ```sql
   select vault.create_secret('123456789:AAH…', 'telegram_bot_token');
   select vault.create_secret('-1001234567890', 'telegram_chat_id');
   ```

5. In the dashboard, open **Notifications**, then press **Refresh status** and **Send test message**.
6. Optional: in **Settings**, fill in **Dashboard link** (e.g. `https://allureboutique.com/admin.html`). Every Telegram alert will then include a link to it.

To change the token or chat ID later, run:

```sql
select vault.update_secret((select id from vault.secrets where name = 'telegram_bot_token'), 'NEW_TOKEN');
select vault.update_secret((select id from vault.secrets where name = 'telegram_chat_id'), 'NEW_CHAT_ID');
```

### Browser alerts: while the dashboard is open

Open **Notifications** in the dashboard and press **Enable pop-ups**. While the dashboard is open, each new order plays a chime, shows a pop-up, and appears at the top of the Orders list. The tab title shows how many new orders there are, e.g. "(2) New orders".

## 6. Publish the website on Railway

The project includes everything Railway needs: a `Dockerfile` that serves the site with the Caddy web server, and `railway.json`. Only the website files go online. The SQL files, setup notes and design folders stay private.

1. Push the project to GitHub. The repository is `github.com/ahmedahmedsaber/allureboutique`.
2. Go to **railway.com**, sign in with GitHub, then **New Project → Deploy from GitHub repo**, and pick `allureboutique`. Allow Railway to access the repository if it asks.
3. Railway builds the site automatically, usually in 1–2 minutes. No variables are needed.
4. Open the service, go to **Settings → Networking**, and click **Generate Domain**. You get an address like `allureboutique-production.up.railway.app`. You can also add your own domain there.
5. In Supabase **Authentication → URL Configuration**, set **Site URL** to that address and add it to **Redirect URLs** (step 3).
6. In the dashboard's **Settings**, set **Dashboard link** to `https://<your address>/admin.html` so Telegram alerts link to it.

Every time new code is pushed to the `main` branch on GitHub, Railway redeploys the site automatically.

## 7. Arabic

- **The shop:** visitors switch with the **عربي / English** button in the header (or in the menu on phones). The whole site flips to right-to-left with Arabic fonts, and the choice is remembered. English is the default.
- **The dashboard:** it has its own **عربي / English** switch in the sidebar and on the sign-in page.
- **Arabic content:**
  - Every product has optional Arabic fields: name, description, material, size, colour and "comes with". Colours and set pieces have an Arabic name next to the English one.
  - In **Settings** you'll find Arabic fields for the banner texts, the address and opening hours, city names and category names.
  - If an Arabic field is empty, the shop shows the English text instead.
- **Spotting gaps:** products without an Arabic name are marked **no Arabic** in the Products list.

## Daily use

**InstaPay / VC orders:**
1. The customer sends a screenshot on WhatsApp.
2. In the order, press **Mark payment received**.
3. When it goes out, press **Mark shipped**.
4. When it's delivered, press **Mark received**.

**Cash on delivery, home delivery:** the delivery fee comes by InstaPay first. Mark it received, then ship.

**Cash on delivery, pickup:** nothing to collect upfront.

Customers see each status change on their **My Orders** page or the **Track an Order** page.

**Other things you can do in the dashboard:**
- **Order actions:** open an order, then use **Manage order**.

  | Action | What happens | Stock | Revenue |
  |---|---|---|---|
  | **Cancel** | The order didn't go ahead | Pieces go back | Not counted |
  | **Edit order** | Change pieces, quantities, prices, options, customer details, delivery | Follows the change | Updated |
  | **Exchange** | The customer swapped pieces; edit the items, and the order is marked *Exchanged* | Old pieces back, new pieces out | Updated |
  | **Return / refund** | Money back, full or partial; tick "returned to stock" if the pieces came back | Optional | The refund is subtracted |
  | **Delete** | Removes a test or spam order for good | Optional | Removed |

  Every change is written to the order's **change log**.
- **Customers:**
  - Lists every account and guest (by phone number) with their orders, total spent and last order date. A chart shows sign-ups, and you can see your top customers.
  - Open a customer to edit their name or phone, or to **Block** them.
  - A blocked account can't sign in to order and can't post reviews, and its phone number can't place orders, even as a guest. You can also block a phone number by itself.
- **Pages:** edit the Returns & Exchange policy, Shipping, and Terms pages in English and Arabic, with a live preview.
- **Export:** download an Excel file for any time range (to the minute). It has sheets for orders, order items, customers, products & sales, and reviews.
- **Photos:** every product photo and banner can be cropped before upload (✂ also re-crops an existing photo).
  - Product photos: **1200 × 1600 px** (portrait 3:4), at least 900 × 1200.
  - Each product can also have a **size chart** image. The shop shows a "Size chart" button on the product page.
- **InstaPay:** in **Settings**, add your InstaPay number **and** your InstaPay payment link. Customers see a "Pay with InstaPay link" button on the confirmation page and in their email.
- **Reviews on the home page:** the average star rating and the number of reviews are shown above the reviews. Turn this on or off in **Settings → Reviews on the home page**.
- **Products:** add photos, prices, stock, sale prices and the choices customers make (color, letter, ring size, bag size, set pieces).
  - Each order lowers stock automatically.
  - At 0 the product shows "Out of stock".
- **Reviews:** customer reviews appear on the home page only after you press **Approve**.
- **Settings:** season banner (upload a background photo, recommended 2400 × 1100 px, crop it before upload), delivery fees per city, discount codes, InstaPay and WhatsApp numbers, contact details.
- **Insights:**
  - **Live now:** visitors online, active carts and people at checkout, updating instantly.
  - **History:** impressions (page views), unique visitors, a shopping funnel from visit to order, abandoned carts, traffic sources, devices, most visited pages, and product interest.
  - **Privacy:** visitors are counted anonymously with a random ID, with no names or phone numbers. Your own browsing while signed in as owner isn't counted.
  - **Tracking where visitors come from:** when you share a link, add `?utm_source=instagram` (or `tiktok`, `whatsapp` …) after the address, e.g. `https://allureboutique.com/?utm_source=instagram`.

## Good to know

- **Free plan pauses:** Supabase may pause a free project after about a week with no activity. A live shop with visitors stays active. You can also upgrade to the Pro plan for guaranteed uptime and daily backups.
- **Prices are checked by the database:** prices, discounts, delivery fees and stock are worked out by the database at checkout. Changing anything in the browser can't change what a customer pays.
- **Starting catalogue:** the products from `seed.sql` are examples. Edit or hide them in **Products**. Unticking **Show in the shop** hides a product and keeps its past orders.
