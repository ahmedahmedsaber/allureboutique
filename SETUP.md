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

## 3. Customer logins and email

1. In **Authentication → URL Configuration**, set **Site URL** to your shop's address, e.g. `https://allureboutique.com`. While testing on your computer, use `http://localhost:8000`.
2. Add the same address to **Redirect URLs**.
3. In **Authentication → Sign In / Providers → Email**, choose how sign-up works:
   - **Confirm email ON** (recommended): customers click a link in an email before they can sign in.
   - **Confirm email OFF**: customers are signed in straight away.
4. **Before you launch**, set up your own email sender under **Authentication → Emails → SMTP Settings**. Supabase's built-in sender is for testing only and sends just a few emails per hour. Without it, sign-up and password-reset emails will stop arriving once the shop gets busy. Any SMTP service works, for example Resend, Brevo, Zoho Mail, or Google Workspace.

Guests can always check out without an account. They track their order with the order number and their phone number on the **Track an Order** page.

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
- **Cancel an order:** this puts the pieces back in stock automatically.
- **Products:** add photos, prices, stock, sale prices and the choices customers make (color, letter, ring size, bag size, set pieces).
  - Each order lowers stock automatically.
  - At 0 the product shows "Out of stock".
- **Reviews:** customer reviews appear on the home page only after you press **Approve**.
- **Settings:** season banner (upload a background photo, recommended 2400 × 1100 px), delivery fees per city, discount codes, InstaPay and WhatsApp numbers, contact details.
- **Insights:**
  - **Live now:** visitors online, active carts and people at checkout, updating instantly.
  - **History:** impressions (page views), unique visitors, a shopping funnel from visit to order, abandoned carts, traffic sources, devices, most visited pages, and product interest.
  - **Privacy:** visitors are counted anonymously with a random ID, with no names or phone numbers. Your own browsing while signed in as owner isn't counted.
  - **Tracking where visitors come from:** when you share a link, add `?utm_source=instagram` (or `tiktok`, `whatsapp` …) after the address, e.g. `https://allureboutique.com/?utm_source=instagram`.

## Good to know

- **Free plan pauses:** Supabase may pause a free project after about a week with no activity. A live shop with visitors stays active. You can also upgrade to the Pro plan for guaranteed uptime and daily backups.
- **Prices are checked by the database:** prices, discounts, delivery fees and stock are worked out by the database at checkout. Changing anything in the browser can't change what a customer pays.
- **Starting catalogue:** the products from `seed.sql` are examples. Edit or hide them in **Products**. Unticking **Show in the shop** hides a product and keeps its past orders.
