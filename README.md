# ALLURE Boutique

Luxury accessories shop with owner dashboard, in English and Arabic, backed by Supabase and hosted on Railway.

- `index.html` + `app.js`: the shop (catalogue, cart, InstaPay / cash-on-delivery checkout, accounts, order tracking, reviews)
- `admin.html` + `admin.js`: owner dashboard (orders, products and photos, reviews, settings, sales overview, notifications)
- `api.js`: data layer shared by both; `config.js`: Supabase URL + anon key
- `i18n.js` + `i18n.ar.js`: English/Arabic switching and the Arabic translations
- `supabase/schema.sql`: tables, security rules, checkout pricing, Telegram order alerts; `supabase/seed.sql`: starting catalogue
- `supabase/arabic.sql`: adds Arabic text to an existing store
- `tools/build_seed.js`: regenerates `seed.sql` and `arabic.sql` from `tools/demo_catalog.js` + `tools/arabic_content.js`
- `Dockerfile`, `Caddyfile`, `railway.json`: Railway hosting (Caddy serves only the website files)

Setup and going live: see **SETUP.md**.

Run locally: `python3 -m http.server 8000`, then open http://localhost:8000 (shop) and http://localhost:8000/admin.html (dashboard).
