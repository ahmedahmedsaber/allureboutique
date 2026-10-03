/* ALLURE Boutique — shop front-end (hash router + views), English / Arabic.
   Catalogue, accounts, orders and reviews come from Supabase via api.js.
   Only the cart, favourites, theme and language are kept in the visitor's browser. */
(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const t = I18N.t, isAr = () => I18N.isAr();
I18N.init('au.lang', 'en');
let STORE = {}, CATEGORIES = [], PRODUCTS = [], REVIEWS = [];

// ───────────────────────── storage ─────────────────────────
const store = {
  get(k, d) { try { const v = localStorage.getItem('au.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('au.' + k, JSON.stringify(v)); } catch (e) {} },
};

const S = {
  theme: store.get('theme', 'light'),
  cart: store.get('cart', []),
  favs: store.get('favs', []),
  promo: store.get('promo', null),            // {code, rate} — re-checked by the server at checkout
  receipts: store.get('receipts', []),        // recent orders placed on this device (for the confirmation page)
  user: null,                                 // profile row when signed in
  orders: [],                                 // signed-in customer's orders
  loading: true, loadError: '',
  ui: {
    menu: false, cats: false, openCat: {}, search: false, q: '',
    filterOpen: false, sortOpen: false, sort: 'default',
    filter: emptyFilter(), draft: emptyFilter(),
    pdp: null, promoInput: '', promoMsg: null,
    co: { step: 1, form: {}, fulfil: 'delivery', pay: '', errors: {}, msg: '', busy: false },
    auth: { mode: 'signin', form: {}, msg: '', ok: '', busy: false },
    acctTab: 'profile', open: {}, prevOpen: true, profile: null, profileMsg: '',
    fb: { rating: 0, text: '', msg: '', ok: '', busy: false },
    track: { no: '', phone: '', result: null, msg: '', busy: false },
    reset: { pw: '', msg: '', ok: '' },
  },
};
function emptyFilter() { return { inStock: false, outStock: false, min: '', max: '', cats: [] }; }
const save = (...keys) => keys.forEach(k => store.set(k, S[k]));

// ───────────────────────── helpers ─────────────────────────
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => Math.round(n || 0).toLocaleString('en-US') + ' ' + I18N.currency();
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const byId = id => PRODUCTS.find(p => p.id === id);
const catBySlug = s => CATEGORIES.find(c => slug(c.name) === s);
const stars = r => '★★★★★'.slice(0, Math.round(r)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(r));
const discountPct = p => p.oldPrice ? Math.round((1 - p.price / p.oldPrice) * 100) : 0;
const hash = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const needsOptions = p => !!(p.options && Object.keys(p.options).length);
const fmtDate = (d, withTime) => new Date(d).toLocaleString(I18N.locale(), withTime ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' });
const waLink = text => `https://wa.me/${STORE.whatsapp}?text=${encodeURIComponent(text)}`;
const arrow = () => (isAr() ? '←' : '→');
const n1 = (n, one, many) => t(n === 1 ? one : many, { n });

// localized owner-entered content (Arabic when filled in, English otherwise)
const pName = p => I18N.pick(p.name, p.nameAr);
const pDesc = p => I18N.pick(p.desc, p.descAr);
const pMaterial = p => I18N.pick(p.material, p.materialAr);
const pSize = p => I18N.pick(p.size, p.sizeAr);
const pColor = p => I18N.pick(p.color, p.colorAr);
const pComes = p => (isAr() && p.comesWithAr && p.comesWithAr.length ? p.comesWithAr : p.comesWith) || [];
const catName = name => { const c = CATEGORIES.find(x => x.name === name); return c ? I18N.pick(c.name, c.ar) : name; };
const subName = (cat, sub) => { const c = CATEGORIES.find(x => x.name === cat); return I18N.pick(sub, c && c.subs_ar && c.subs_ar[sub]); };
const prodCat = p => catName(p.cat) + (p.sub ? ' · ' + subName(p.cat, p.sub) : '');
const optLbl = (list, name) => { const o = (list || []).find(x => x.name === name); return o ? I18N.pick(I18N.opt(o.name), o.ar) : I18N.opt(name); };
const deliveries = () => Array.isArray(STORE.delivery) ? STORE.delivery : Object.entries(STORE.delivery || {}).map(([city, fee]) => ({ city, fee }));
const deliveryFee = city => (deliveries().find(d => d.city === city) || {}).fee || 0;
const cityName = city => { const d = deliveries().find(x => x.city === city); return d ? I18N.pick(d.city, d.ar) : city; };
const sAddress = () => I18N.pick(STORE.address, STORE.address_ar);
const sHours = () => I18N.pick(STORE.hours, STORE.hours_ar);
const itemName = i => { const p = byId(i.id); return p ? pName(p) : i.name; };

const ICONS = {
  menu: '<path d="M3 6.5h18M3 12h18M3 17.5h18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20.5c.6-3.8 4-5.8 8-5.8s7.4 2 8 5.8"/>',
  heart: '<path d="M12 20.3s-7.4-4.5-9.1-9.2C1.7 7.8 4 4.6 7.3 4.6c2 0 3.6 1.1 4.7 2.7 1.1-1.6 2.7-2.7 4.7-2.7 3.3 0 5.6 3.2 4.4 6.5-1.7 4.7-9.1 9.2-9.1 9.2z"/>',
  bag: '<path d="M5 8.5h14l-1.1 12H6.1L5 8.5z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>',
  filter: '<path d="M3 7h11M18 7h3M3 17h4M11 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  close: '<path d="M5 5l14 14M19 5L5 19"/>',
  facebook: '<path d="M14.2 8.2h2.3V4.6h-2.7c-2.7 0-4.1 1.6-4.1 4.3v2.2H7.5v3.5h2.2V21h3.6v-6.4h2.6l.5-3.5h-3.1V9.3c0-.7.3-1.1.9-1.1z" fill="currentColor" stroke="none"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".9" fill="currentColor" stroke="none"/>',
  tiktok: '<path d="M14 3.5v11.2a3.6 3.6 0 1 1-3.6-3.6"/><path d="M14 3.5c.5 2.6 2.4 4.4 5 4.6"/>',
  whatsapp: '<path d="M20 11.6a8.4 8.4 0 0 1-12.5 7.3L3.6 20l1.2-3.6A8.4 8.4 0 1 1 20 11.6z"/><path d="M9 8.6c.2 2.7 2.7 5.4 5.6 5.9l1-1.3-1.8-.9-.8.8c-1-.4-2-1.4-2.4-2.4l.8-.8-.9-1.8-1.5.5z" fill="currentColor" stroke="none"/>',
};
const icon = n => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

// product pictures: real photos when uploaded, otherwise the gradient placeholders
const gallery = p => p.images && p.images.length ? p.images.map(u => ({ img: u }))
  : [p.bg, p.bg.replace('150deg', '210deg'), p.bg.replace('150deg', '95deg'), p.bg.replace('150deg', '320deg')].map(bg => ({ bg }));
const picture = (p, cls = 'bgfill') => p.images && p.images.length
  ? `<img class="${cls} photo" src="${esc(p.images[0])}" alt="${esc(pName(p))}" loading="lazy">`
  : `<div class="${cls}" style="background:${p.bg}"></div>`;
const thumbStyle = (img, bg) => img ? `background:url('${esc(img)}') center/cover` : `background:${bg}`;

// ───────────────────────── cart & pricing (display only — the server re-prices) ─────────────────────────
function unitPrice(p, opts = {}) {
  const parts = p.options && p.options.setParts;
  if (parts && opts.parts && opts.parts.length) {
    if (opts.parts.length === parts.length) return p.price;
    return parts.filter(x => opts.parts.includes(x.name)).reduce((a, x) => a + x.price, 0);
  }
  return p.price;
}
function optText(opts = {}, id) {
  const p = byId(id), o = (p && p.options) || {}, out = [];
  if (opts.color) out.push(t('Color: {v}', { v: optLbl(o.colors, opts.color) }));
  if (opts.letter) out.push(t('Letter: {v}', { v: opts.letter }));
  if (opts.ringSize) out.push(t('Ring size: {v}', { v: opts.ringSize }));
  if (opts.bagSize) out.push(t('Bag size: {v}', { v: opts.bagSize }));
  if (opts.parts && opts.parts.length) out.push(t('Pieces: {v}', { v: opts.parts.map(x => optLbl(o.setParts, x)).join(isAr() ? '، ' : ', ') }));
  return out;
}
function addToCart(id, opts = {}, qty = 1) {
  const key = id + '|' + JSON.stringify(opts);
  const line = S.cart.find(l => l.key === key);
  if (line) line.qty += qty; else S.cart.push({ key, id, opts, qty });
  save('cart'); updateBadges();
  track('add_to_cart', { product_id: id });
}
function cleanCart() {   // drop lines for products that were removed from the shop
  const before = S.cart.length;
  S.cart = S.cart.filter(l => byId(l.id)); if (S.cart.length !== before) save('cart');
}
function totals(ctx = {}) {
  const sub = S.cart.reduce((a, l) => { const p = byId(l.id); return p ? a + unitPrice(p, l.opts) * l.qty : a; }, 0);
  const disc = S.promo ? Math.round(sub * S.promo.rate) : 0;
  let del = null;
  if (ctx.fulfil === 'pickup') del = 0;
  else if (ctx.city) del = deliveryFee(ctx.city);
  return { sub, disc, del, total: sub - disc + (del || 0), count: S.cart.reduce((a, l) => a + l.qty, 0) };
}
function toggleFav(id) {
  const i = S.favs.indexOf(id);
  if (i < 0) { S.favs.push(id); toast(t('Added to favourites'), t('VIEW'), '#/favourites'); } else S.favs.splice(i, 1);
  save('favs'); updateBadges();
}

// ───────────────────────── toast ─────────────────────────
let toastT;
function toast(msg, label, href) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${label ? `<button data-act="go" data-href="${href}">${label}</button>` : ''}`;
  el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3000);
}

// ───────────────────────── visitor insights (anonymous) ─────────────────────────
// A random id per browser + per 30-minute session. No names, phones or addresses are sent.
// The owner's own browsing is skipped (also enforced in the database).
const rid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 24);
const VISITOR = store.get('vid', null) || (() => { const v = rid(); store.set('vid', v); return v; })();
const DEVICE = innerWidth <= 600 ? 'mobile' : (matchMedia('(pointer: coarse)').matches && innerWidth <= 1100) ? 'tablet' : 'desktop';
let pendingRef = '';
function refSource() {
  const utm = new URLSearchParams(location.search).get('utm_source');
  if (utm) return utm.toLowerCase().slice(0, 40);
  let host = ''; try { host = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; } catch (e) {}
  if (!host || host === location.hostname) return '';
  const known = [['instagram', 'instagram'], ['facebook', 'facebook'], ['fb.', 'facebook'], ['tiktok', 'tiktok'], ['google', 'google'], ['whatsapp', 'whatsapp'], ['wa.me', 'whatsapp'], ['bing', 'bing'], ['t.co', 'twitter'], ['snapchat', 'snapchat']];
  const k = known.find(([m]) => host.includes(m));
  return k ? k[1] : host.slice(0, 60);
}
function sessionId() {
  const now = Date.now(), s = store.get('sid', null);
  if (s && now - s.t < 30 * 60e3) { s.t = now; store.set('sid', s); return s.id; }
  const n = { id: rid(), t: now }; store.set('sid', n); pendingRef = refSource(); return n.id;
}
const pathFor = h => {
  const [a, b] = (h || '').replace(/^#\/?/, '').split('/');
  if (!a) return '/';
  if (a === 'product' || a === 'shop' || a === 'page') return '/' + [a, b].filter(Boolean).join('/') + (a === 'shop' && h.split('/')[3] ? '/' + h.split('/')[3] : '');
  return '/' + a;
};
let trackOn = null; const trackQueue = [];
function track(type, extra = {}) {
  if (!API.ready) return;
  const ev = { type, visitor: VISITOR, session: sessionId(), device: DEVICE, path: pathFor(location.hash), ...extra };
  if (type === 'page_view' && pendingRef) { ev.referrer = pendingRef; pendingRef = ''; }
  if (trackOn === null) trackQueue.push(ev); else if (trackOn) API.trackEvent(ev);
}
function setTracking(on) {
  trackOn = on;
  if (on) trackQueue.splice(0).forEach(API.trackEvent); else trackQueue.length = 0;
  presenceUpdate();
}
let lastTracked = null;
function trackRoute() {
  const path = pathFor(location.hash);
  if (path === lastTracked) return;
  lastTracked = path;
  track('page_view');
  const [a, b] = location.hash.replace(/^#\/?/, '').split('/');
  if (a === 'product' && byId(b)) track('product_view', { product_id: b });
  if (a === 'checkout' && S.cart.length) track('checkout_start');
}
// "Live now" in the dashboard: each open tab announces its page, cart size and whether it's at checkout.
let presenceCh = null, presenceT = null;
function presenceUpdate() {
  if (!API.ready) return;
  clearTimeout(presenceT);
  presenceT = setTimeout(() => {
    if (trackOn !== true) { if (presenceCh && trackOn === false) { API.sb.removeChannel(presenceCh); presenceCh = null; } return; }
    const state = () => ({ page: pathFor(location.hash), cart: S.cart.reduce((a, l) => a + l.qty, 0),
      checkout: /^#\/checkout/.test(location.hash) && S.cart.length > 0, device: DEVICE, lang: I18N.lang, since: Date.now() });
    if (!presenceCh) {
      presenceCh = API.presence(VISITOR);
      presenceCh.subscribe(st => { if (st === 'SUBSCRIBED') presenceCh.track(state()); });
    } else presenceCh.track(state());
  }, 500);
}

// ───────────────────────── shared pieces ─────────────────────────
function card(p) {
  const fav = S.favs.includes(p.id);
  const pill = p.oldPrice ? `<span class="pill sale">−${discountPct(p)}%</span>` : (p.flags.new ? `<span class="pill new">${t('NEW')}</span>` : '');
  return `<div class="card" data-act="open" data-id="${p.id}">
    <div class="card-img">
      ${picture(p)}
      ${pill}
      <button class="card-fav${fav ? ' on' : ''}" data-act="fav" data-id="${p.id}" aria-label="${t('Favourite')}">${icon('heart')}</button>
      ${p.images && p.images.length ? '' : `<span class="card-tag">${esc((p.sub || p.cat).toUpperCase())}</span>`}
      ${p.inStock ? '' : `<div class="oos"><span>${t('Out of stock')}</span></div>`}
      <button class="card-add" data-act="quick" data-id="${p.id}" aria-label="${t('Add to cart')}"${p.inStock ? '' : ' disabled style="opacity:.4;cursor:not-allowed"'}>${icon('bag')}</button>
    </div>
    <div class="card-body">
      <div class="card-cat">${esc(prodCat(p))}</div>
      <div class="card-name">${esc(pName(p))}</div>
      <div class="price">${p.oldPrice ? `<s>${money(p.oldPrice)}</s>` : ''}<span class="now${p.oldPrice ? ' red' : ''}">${money(p.price)}</span></div>
      <div class="code">#${esc(p.code)}</div>
    </div>
  </div>`;
}
function secHead(eyebrow, title, href) {
  return `<div class="sec-head"><div><div class="eyebrow">${eyebrow}</div><h2 class="h2">${title}</h2></div>
    ${href ? `<button class="link-btn" data-act="go" data-href="${href}">${t('VIEW ALL')} ${arrow()}</button>` : ''}</div>`;
}
function carousel(id, items, cls = '') {
  return `<div class="carousel">
    <button class="car-arrow prev" data-act="car" data-target="${id}" data-dir="-1" aria-label="${t('Previous')}">${isAr() ? '›' : '‹'}</button>
    <div class="car-track ${cls}" id="${id}">${items.join('')}</div>
    <button class="car-arrow next" data-act="car" data-target="${id}" data-dir="1" aria-label="${t('Next')}">${isAr() ? '‹' : '›'}</button>
  </div>`;
}
const pageHead = (crumbs, title, sub) => `<section class="page-head"><div class="wrap">
  <div class="crumb">${crumbs.map(([c, h]) => h ? `<button data-act="go" data-href="${h}">${esc(c)}</button>` : esc(c)).join(' / ')}</div>
  <h1 class="page-h1">${title}</h1>${sub ? `<p class="page-sub">${sub}</p>` : ''}</div></section>`;
const busyAttr = b => b ? ' disabled aria-busy="true"' : '';
const emptyBlock = (title, text) => `<div class="empty" style="padding:88px 16px"><span class="serif">${title}</span>${text}<div style="margin-top:26px"><button class="btn btn-gold" data-act="go" data-href="#/shop/all">${t('SHOP THE COLLECTION')}</button></div></div>`;

// ───────────────────────── header / menu / footer ─────────────────────────
function renderHeader() {
  const dark = S.theme === 'dark';
  $('#hdr').innerHTML = `<div class="hdr-inner">
    <div class="hdr-left">
      <button class="icon-btn" data-act="menu" aria-label="${t('Menu')}">${icon('menu')}</button>
      <button class="icon-btn" data-act="search" aria-label="${t('Search')}">${icon('search')}</button>
    </div>
    <button class="logo" data-act="go" data-href="#/" aria-label="${t('ALLURE Boutique — home')}">
      <img class="logo-light" src="assets/logo-light.png" alt="ALLURE Boutique"><img class="logo-dark" src="assets/logo-dark.png" alt="ALLURE Boutique">
    </button>
    <div class="hdr-right">
      <button class="theme-btn" data-act="theme" title="${t('Toggle theme')}"><span class="t-ico">${dark ? '☀' : '☾'}</span><span class="t-lbl">${dark ? t('NOIR') : t('IVORY')}</span></button>
      <button class="lang" data-act="lang" lang="${isAr() ? 'en' : 'ar'}">${isAr() ? 'English' : 'عربي'}</button>
      <button class="icon-btn" data-act="go" data-href="#/account" aria-label="${t('My account')}">${icon('user')}</button>
      <button class="icon-btn" data-act="go" data-href="#/favourites" aria-label="${t('Favourites')}">${icon('heart')}<span class="badge" id="favN"></span></button>
      <button class="icon-btn" data-act="go" data-href="#/cart" aria-label="${t('Cart')}">${icon('bag')}<span class="badge" id="cartN"></span></button>
    </div>
  </div>
  <div class="search-bar"${S.ui.search ? '' : ' hidden'}><div class="wrap">
    ${icon('search')}<input id="q" type="search" placeholder="${t('Search by name or code (e.g. Necklace, #401)')}" value="${esc(S.ui.q)}" autocomplete="off">
    <button class="icon-btn" data-act="search" aria-label="${t('Close search')}">${icon('close')}</button>
  </div></div>`;
  updateBadges();
}
function updateBadges() {
  const c = $('#cartN'), f = $('#favN');
  if (c) { const n = S.cart.reduce((a, l) => a + l.qty, 0); c.textContent = n; c.dataset.n = n; }
  if (f) { f.textContent = S.favs.length; f.dataset.n = S.favs.length; }
  if (trackOn) presenceUpdate();
}

function renderMenu() {
  const u = S.ui, item = (label, h, cls = '') => `<button class="nav-item ${cls}" data-act="go" data-href="${h}">${label}</button>`;
  const catBlock = CATEGORIES.map(c => {
    const s = slug(c.name), cn = esc(catName(c.name));
    if (!c.subs || !c.subs.length) return item(cn, '#/shop/' + s, 'sub hl');
    const open = u.openCat[c.name];
    return `<button class="nav-item sub hl" data-act="menuCat" data-cat="${esc(c.name)}">${cn}<span class="car${open ? ' open' : ''}">▼</span></button>
      ${open ? item(t('All {cat}', { cat: cn }), '#/shop/' + s, 'sub2') + c.subs.map(x => item(esc(subName(c.name, x)), `#/shop/${s}/${slug(x)}`, 'sub2')).join('') : ''}`;
  }).join('');
  $('#menu').innerHTML = `<div class="drawer-head"><div class="ttl">${icon('menu')} ${t('Menu')}</div>
      <button class="icon-btn" style="color:inherit" data-act="closeDrawers" aria-label="${t('Close menu')}">${icon('close')}</button></div>
    <div class="drawer-body">
      ${item(t('Home'), '#/')}${item(t('On Sale'), '#/shop/sale')}${item(t('Best Sellers'), '#/shop/best')}${item(t('New Arrivals'), '#/shop/new')}
      <button class="nav-item" data-act="menuCats">${t('Categories')}<span class="car${u.cats ? ' open' : ''}">▼</span></button>
      ${u.cats ? catBlock : ''}
      ${item(S.user ? t('My Account') : t('Sign In'), '#/account')}${item(t('My Orders'), S.user ? '#/orders' : '#/track')}${item(t('Track an Order'), '#/track')}${item(t('Reviews'), '#/reviews')}
      ${item(t('Terms of Service'), '#/page/terms')}${item(t('Our Policy'), '#/page/policy')}${item(t('Shipping Policy'), '#/page/shipping')}
      ${item(t('Location'), '#/page/location')}${item(t('Contact Us'), '#/page/contact')}${item(t('About Us'), '#/page/about')}
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="drawer-theme" data-act="theme">${S.theme === 'dark' ? '☀ ' + t('IVORY MODE') : '☾ ' + t('NOIR MODE')}</button>
        <button class="drawer-theme" data-act="lang">${isAr() ? 'English' : 'عربي'}</button>
      </div>
    </div>`;
}

function renderFooter() {
  const col = (h, links) => `<div class="ftr-col"><div class="h">${h}</div>${links.map(([l, href]) => `<button data-act="go" data-href="${href}">${l}</button>`).join('')}</div>`;
  const so = STORE.socials || {};
  $('#ftr').innerHTML = `<div class="ftr-grid">
      <div class="ftr-brand">
        <img class="logo-light" src="assets/logo-light.png" alt="ALLURE Boutique"><img class="logo-dark" src="assets/logo-dark.png" alt="ALLURE Boutique">
        <p>${t('A curated house of luxury accessories. Be different, anytime anywhere.')}</p>
        <div class="socials">
          ${so.facebook ? `<a href="${esc(so.facebook)}" target="_blank" rel="noopener" aria-label="Facebook">${icon('facebook')}</a>` : ''}
          ${so.instagram ? `<a href="${esc(so.instagram)}" target="_blank" rel="noopener" aria-label="Instagram">${icon('instagram')}</a>` : ''}
          ${so.tiktok ? `<a href="${esc(so.tiktok)}" target="_blank" rel="noopener" aria-label="TikTok">${icon('tiktok')}</a>` : ''}
        </div>
      </div>
      ${col(t('POLICIES'), [[t('Our Policy'), '#/page/policy'], [t('Shipping Policy'), '#/page/shipping']])}
      ${col(t('HOUSE'), [[t('About Us'), '#/page/about'], [t('Contact Us'), '#/page/contact']])}
      ${col(t('HELP'), [[t('Terms of Service'), '#/page/terms'], [t('Visit Us'), '#/page/location'], [t('Track an Order'), '#/track']])}
    </div>
    <div class="ftr-bottom"><div>${t('© {year} ALLURE Boutique. All rights reserved.', { year: new Date().getFullYear() })}</div><div>${t('VALUE 2 MALL · NEW CAIRO')}</div></div>`;
}

// ───────────────────────── views ─────────────────────────
const top4 = flag => PRODUCTS.filter(p => p.flags[flag]).sort((a, b) => (b.inStock - a.inStock) || (b.popularity - a.popularity)).slice(0, 4);

function viewHome() {
  const pr = STORE.promo && STORE.promo.enabled !== false ? STORE.promo : null;
  const P = k => I18N.pick(pr[k], pr[k + '_ar']);
  const hero = pr ? `<section class="hero">
      <div class="hero-bg"${pr.image ? ` style="background:url('${esc(pr.image)}') center/cover"` : ''}></div><div class="hero-shade"></div>
      <div class="wrap"><div class="hero-content">
        <div class="hero-kicker">${esc(P('kicker'))}</div>
        ${pr.big ? `<div class="promo-big">${esc(pr.big)}<small>${esc(P('small'))}</small></div>` : ''}
        <h1 class="hero-h1" style="margin-top:14px"><em>${esc(P('title'))}</em></h1>
        <p class="hero-p">${esc(P('text'))}</p>
        <div class="hero-btns">
          <button class="btn btn-gold" data-act="go" data-href="#/shop/sale">${esc(P('cta') || t('SHOP THE SALE'))} ${arrow()}</button>
          <button class="btn hero-ghost" data-act="go" data-href="#/shop/all">${t('SHOP ALL')}</button>
        </div></div></div>
    </section>` : `<section class="hero">
      <div class="hero-bg"></div><div class="hero-shade"></div>
      <div class="wrap"><div class="hero-content">
        <div class="hero-kicker">${t('NEW CAIRO · VALUE 2 MALL')}</div>
        <h1 class="hero-h1">${t('Be different,')}<br><em>${t('anytime anywhere.')}</em></h1>
        <p class="hero-p">${t('A curated house of bags, sunglasses, fine jewelry and watches — every piece handpicked, every detail authentic.')}</p>
        <div class="hero-btns"><button class="btn btn-gold" data-act="go" data-href="#/shop/all">${t('SHOP THE COLLECTION')} ${arrow()}</button>
        <button class="btn hero-ghost" data-act="go" data-href="#/page/about">${t('OUR STORY')}</button></div>
      </div></div></section>`;

  const marq = ['Authenticated Luxury', 'New Cairo · Value 2 Mall', 'Complimentary Gift Wrap', 'Free Pickup from Our Branch', 'Handpicked Daily', 'Lifetime Authenticity']
    .map(m => `<span class="marquee-item"><span>${t(m)}</span><i>✦</i></span>`).join('');

  const cats = CATEGORIES.map(c => {
    const n = PRODUCTS.filter(p => p.cat === c.name).length;
    return `<button class="cat-card" data-act="go" data-href="#/shop/${slug(c.name)}">
      <div class="bgfill" style="background:${c.image ? `url('${esc(c.image)}') center/cover` : c.bg}"></div><div class="shade"></div><span class="tag">${esc(c.tag || c.name.toUpperCase())}</span>
      <div class="lbl"><div class="nm">${esc(catName(c.name))}</div><div class="ct">${n1(n, '{n} PIECE', '{n} PIECES')} ${arrow()}</div></div></button>`;
  }).join('');

  const row = (flag, eyebrow, title) => { const items = top4(flag); return items.length ? `<section class="sec">${secHead(eyebrow, title, '#/shop/' + flag)}<div class="grid4">${items.map(card).join('')}</div></section>` : ''; };

  const fb = S.ui.fb;
  const reviewCards = REVIEWS.map(r => `<div class="review"><div class="nm" dir="auto">${esc(r.name)}</div><div class="st">${stars(r.rating)}</div>
      <p dir="auto">“${esc(r.text)}”</p><div class="dt">${fmtDate(r.created_at).toUpperCase()}</div></div>`);

  return `${hero}
    <section class="marquee"><div class="marquee-track"><div style="display:flex">${marq}</div><div style="display:flex">${marq}</div></div></section>
    ${row('sale', t('LIMITED TIME'), t('On Sale!'))}
    ${row('best', t('MOST LOVED'), t('Best Sellers'))}
    ${row('new', t('JUST ARRIVED'), t('New Collection'))}
    <section class="sec" style="padding-bottom:88px">
      <div class="sec-head center"><div class="eyebrow">${t('FIND YOUR PERFECT PIECE')}</div><h2 class="h2" style="font-size:52px">${t('Categories')}</h2><div class="rule"></div></div>
      <div class="grid4">${cats}</div>
    </section>
    <section class="band"><div class="sec" style="padding-bottom:72px">
      <div class="sec-head center"><div class="eyebrow">${t("WE'D LOVE TO HEAR FROM YOU")}</div><h2 class="h2">${t('Give us your feedback')}</h2></div>
      <form class="fb" data-form="feedback">
        <label>${t('RATE')}</label>
        <div class="stars-input">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="${n <= fb.rating ? 'on' : ''}" data-act="star" data-n="${n}" aria-label="${t('{n} stars', { n })}">★</button>`).join('')}</div>
        <label for="fbText">${t('FEEDBACK')}</label>
        <textarea id="fbText" class="field" data-bind="fb.text" maxlength="1000" placeholder="${t('Tell us about your piece, your delivery, our boutique…')}">${esc(fb.text)}</textarea>
        ${fb.msg ? `<div class="form-err" style="text-align:center">${esc(fb.msg)}</div>` : ''}
        ${fb.ok ? `<div class="promo-msg" style="text-align:center;margin:12px 0 0">${esc(fb.ok)}</div>` : ''}
        <div style="text-align:center;margin-top:22px"><button class="btn btn-gold" type="submit"${busyAttr(fb.busy)}>${S.user ? (fb.busy ? t('SENDING…') : t('SUBMIT FEEDBACK')) : t('SIGN IN TO SUBMIT')}</button></div>
        <div class="login-note">${S.user ? t('Posting as {name}', { name: esc(S.user.name || S.user.email) }) : t('You need to be signed in to submit feedback.')}</div>
      </form>
    </div></section>
    ${REVIEWS.length ? `<section class="sec" id="reviews" style="padding-bottom:96px">
      ${secHead(t('FROM OUR CLIENTS'), t('Reviews'))}
      ${carousel('revTrack', reviewCards, 'three')}
    </section>` : '<div id="reviews"></div>'}`;
}

// listing ---------------------------------------------------------------------
const SORTS = [['default', 'Featured'], ['latest', 'Latest'], ['rating', 'Average rating'], ['popularity', 'Popularity'], ['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low']];
const COLLECTIONS = { all: 'The Collection', sale: 'On Sale', best: 'Best Sellers', new: 'New Arrivals' };

function listingBase(key, subSlug, q) {
  if (key === 'search') {
    const s = q.trim().toLowerCase().replace(/^#/, '');
    return { title: t('Results for “{q}”', { q: esc(q) }), items: PRODUCTS.filter(p => !s || [p.name, p.nameAr, p.code, p.cat, p.sub || '', p.material, catName(p.cat)].join(' ').toLowerCase().includes(s)), catFilter: true };
  }
  if (COLLECTIONS[key]) {
    return { title: t(COLLECTIONS[key]), items: key === 'all' ? PRODUCTS.slice() : PRODUCTS.filter(p => p.flags[key]), catFilter: key !== 'all', chips: key === 'all' };
  }
  const cat = catBySlug(key);
  if (!cat) return null;
  const sub = subSlug ? (cat.subs || []).find(x => slug(x) === subSlug) : null;
  return { title: esc(sub ? subName(cat.name, sub) : catName(cat.name)), cat, sub, chips: true, items: PRODUCTS.filter(p => p.cat === cat.name && (!sub || p.sub === sub)) };
}
function applyFilter(items, f) {
  return items.filter(p => {
    if (f.inStock !== f.outStock && (f.inStock ? !p.inStock : p.inStock)) return false;
    if (f.min !== '' && p.price < +f.min) return false;
    if (f.max !== '' && p.price > +f.max) return false;
    if (f.cats.length && !f.cats.includes(p.cat)) return false;
    return true;
  });
}
function applySort(items, s) {
  const a = items.slice();
  if (s === 'latest') a.sort((x, y) => String(y.addedAt).localeCompare(String(x.addedAt)));
  if (s === 'rating') a.sort((x, y) => y.rating - x.rating);
  if (s === 'popularity') a.sort((x, y) => y.popularity - x.popularity);
  if (s === 'price-asc') a.sort((x, y) => x.price - y.price);
  if (s === 'price-desc') a.sort((x, y) => y.price - x.price);
  if (s === 'default') a.sort((x, y) => (y.inStock - x.inStock));
  return a;
}
function viewListing(key, subSlug, q = '') {
  const base = listingBase(key, subSlug, q);
  if (!base) return viewNotFound();
  const u = S.ui, f = u.filter;
  const items = applySort(applyFilter(base.items, f), u.sort);
  S.ui.listCtx = base;

  let chips = '';
  if (base.chips) {
    const active = base.cat ? base.cat.name : 'All';
    chips = `<div class="chips">${[[t('All Pieces'), 'all', 'All'], ...CATEGORIES.map(c => [esc(catName(c.name)), slug(c.name), c.name])]
      .map(([l, s, n]) => `<button class="chip${n === active ? ' on' : ''}" data-act="go" data-href="#/shop/${s}">${l}</button>`).join('')}</div>`;
  }
  const subs = base.cat && base.cat.subs || [];
  const subchips = subs.length ? `<div class="subchips">${[[t('All {cat}', { cat: esc(catName(base.cat.name)) }), ''], ...subs.map(x => [esc(subName(base.cat.name, x)), slug(x)])]
    .map(([l, s]) => `<button class="chip sm${(base.sub ? slug(base.sub) : '') === s ? ' on' : ''}" data-act="go" data-href="#/shop/${slug(base.cat.name)}${s ? '/' + s : ''}">${l}</button>`).join('')}</div>` : '';

  const tags = [];
  if (f.inStock !== f.outStock) tags.push(['avail', f.inStock ? t('In stock') : t('Out of stock')]);
  if (f.min !== '' || f.max !== '') tags.push(['price', `${f.min || 0} – ${f.max || '∞'} ${I18N.currency()}`]);
  f.cats.forEach(c => tags.push(['cat:' + c, catName(c)]));
  const sortLabel = t(SORTS.find(s => s[0] === u.sort)[1]);

  const crumbs = [[t('Home'), '#/'], [t('Shop'), '#/shop/all']];
  if (base.cat) crumbs.push([catName(base.cat.name), base.sub ? '#/shop/' + slug(base.cat.name) : null]);
  if (base.sub) crumbs.push([subName(base.cat.name, base.sub), null]);

  return `${pageHead(crumbs, base.title, n1(items.length, '{n} piece, every one authenticated.', '{n} pieces, every one authenticated.'))}
    <section class="shop">
      <div class="toolbar">
        ${chips || '<div></div>'}
        <div class="tools">
          <button class="tool" data-act="filterOpen">${icon('filter')} ${t('FILTER')}${tags.length ? ` (${tags.length})` : ''}</button>
          <div class="sort-wrap">
            <button class="tool" data-act="sortToggle">${t('SORT: {s}', { s: sortLabel.toUpperCase() })} ▾</button>
            ${u.sortOpen ? `<div class="sort-menu">${SORTS.map(([v, l]) => `<button data-act="sort" data-v="${v}">${t(l)}<span class="radio${u.sort === v ? ' on' : ''}"></span></button>`).join('')}</div>` : ''}
          </div>
        </div>
      </div>
      ${subchips}
      ${tags.length ? `<div class="active-filters">${tags.map(([k, l]) => `<button class="af" data-act="rmFilter" data-k="${esc(k)}">${esc(l)} ✕</button>`).join('')}<button class="af" data-act="filterClearAll">${t('Clear all')}</button></div>` : ''}
      ${items.length ? `<div class="grid4">${items.map(card).join('')}</div>`
        : `<div class="empty"><span class="serif">${t('New pieces arriving soon.')}</span>${base.items.length ? t('No pieces match these filters.') : t('There is nothing in this category yet.')}</div>`}
    </section>`;
}
function renderFilters() {
  const ctx = S.ui.listCtx; if (!ctx) return;
  const d = S.ui.draft, items = ctx.items;
  const inN = items.filter(p => p.inStock).length, outN = items.length - inN;
  const hi = items.reduce((a, p) => Math.max(a, p.price), 0);
  const preview = applyFilter(items, d).length;
  $('#filters').innerHTML = `<div class="drawer-head plain">
      <div class="serif" style="font-size:24px">${t('Filter')}</div><div class="muted" style="font-size:12px;margin-top:4px">${t('{a} of {b} products', { a: preview, b: items.length })}</div>
      <button class="icon-btn x" data-act="closeDrawers" aria-label="${t('Close filter')}">${icon('close')}</button></div>
    <div class="drawer-body">
      <div class="f-sec"><h4>${t('AVAILABILITY')}</h4>
        <label class="check"><input type="checkbox" data-draft="inStock"${d.inStock ? ' checked' : ''}> ${t('In stock')} (${inN})</label>
        <label class="check"><input type="checkbox" data-draft="outStock"${d.outStock ? ' checked' : ''}> ${t('Out of stock')} (${outN})</label></div>
      <div class="f-sec"><h4>${t('PRICE')}</h4>
        <div class="muted" style="font-size:13px;margin-bottom:12px">${t('The highest price is {p}', { p: money(hi) })}</div>
        <div class="range"><input class="field" type="number" min="0" placeholder="${t('From')}" data-draft="min" value="${esc(d.min)}"><span class="muted">–</span>
        <input class="field" type="number" min="0" placeholder="${t('To')}" data-draft="max" value="${esc(d.max)}"></div></div>
      ${ctx.catFilter ? `<div class="f-sec"><h4>${t('FILTER BY CATEGORY')}</h4>${CATEGORIES.map(c => {
        const n = items.filter(p => p.cat === c.name).length;
        return `<label class="check"><input type="checkbox" data-draftcat="${esc(c.name)}"${d.cats.includes(c.name) ? ' checked' : ''}> ${esc(catName(c.name))} (${n})</label>`;
      }).join('')}</div>` : ''}
    </div>
    <div class="drawer-foot"><button class="link-btn" data-act="filterClear">${t('Remove all')}</button><button class="btn btn-ink" data-act="filterApply">${t('APPLY')}</button></div>`;
}

// product ---------------------------------------------------------------------
function viewProduct(id) {
  const p = byId(id);
  if (!p) return viewNotFound();
  if (!S.ui.pdp || S.ui.pdp.id !== id) S.ui.pdp = { id, img: 0, opts: {}, qty: 1, err: '' };
  const st = S.ui.pdp, o = p.options || {}, fav = S.favs.includes(p.id);
  const imgs = gallery(p);
  if (st.img >= imgs.length) st.img = 0;
  const cur = imgs[st.img];
  const price = unitPrice(p, st.opts);

  const grp = (title, chosen, body) => `<div class="opt"><div class="opt-h"><span>${title}</span><b>${chosen ? esc(chosen) : ''}</b></div><div class="opt-row">${body}</div></div>`;
  let opts = '';
  if (o.colors) opts += grp(t('COLOR'), st.opts.color && optLbl(o.colors, st.opts.color), o.colors.map(c => `<button class="swatch${st.opts.color === c.name ? ' on' : ''}" data-act="opt" data-k="color" data-v="${esc(c.name)}"><i style="background:${esc(c.hex)}"></i>${esc(optLbl(o.colors, c.name))}</button>`).join(''));
  if (o.letters) opts += grp(t('NECKLACE LETTER'), st.opts.letter, o.letters.map(l => `<button class="circ sm${st.opts.letter === l ? ' on' : ''}" data-act="opt" data-k="letter" data-v="${esc(l)}">${esc(l)}</button>`).join(''));
  if (o.setParts) {
    const chosen = st.opts.parts || [];
    opts += grp(t('CHOOSE FROM SET'), chosen.length === o.setParts.length ? t('Full set') : chosen.length ? t('{n} selected', { n: chosen.length }) : '',
      o.setParts.map(x => `<button class="set-part${chosen.includes(x.name) ? ' on' : ''}" data-act="part" data-v="${esc(x.name)}"><span class="n">${esc(optLbl(o.setParts, x.name))}</span><span class="p">${money(x.price)}</span></button>`).join(''))
      + `<div class="muted" style="font-size:12px;margin-top:10px">${t('Pick one or more pieces — all {n} together: {p}.', { n: o.setParts.length, p: money(p.price) })}</div>`;
  }
  if (o.ringSizes) opts += grp(t('RING SIZE'), st.opts.ringSize, o.ringSizes.map(s => `<button class="circ${st.opts.ringSize === String(s) ? ' on' : ''}" data-act="opt" data-k="ringSize" data-v="${esc(s)}">${esc(s)}</button>`).join(''));
  if (o.bagSizes) opts += grp(t('BAG SIZE'), st.opts.bagSize, o.bagSizes.map(s => `<button class="circ${st.opts.bagSize === s ? ' on' : ''}" data-act="opt" data-k="bagSize" data-v="${esc(s)}">${esc(s)}</button>`).join(''));

  const related = PRODUCTS.filter(x => x.cat === p.cat && x.id !== p.id).sort((a, b) => hash(a.id + p.id) - hash(b.id + p.id));
  const more = PRODUCTS.filter(x => x.cat !== p.cat).sort((a, b) => hash(a.id + p.id) - hash(b.id + p.id));
  const rel = [...related, ...more].slice(0, 8);

  const spec = (k, v, cls = '') => `<div class="spec ${cls}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const catHref = '#/shop/' + slug(p.cat) + (p.sub ? '/' + slug(p.sub) : '');
  const lowStock = p.inStock && p.stock <= 3;
  const comes = pComes(p);

  return `<div class="pdp-crumb"><button data-act="go" data-href="#/shop/all">${t('SHOP')}</button> / <button data-act="go" data-href="${catHref}">${esc((p.sub ? subName(p.cat, p.sub) : catName(p.cat)).toUpperCase())}</button> / <span style="color:var(--ink)">${esc(pName(p).toUpperCase())}</span></div>
    <section class="pdp">
      <div class="gallery">
        <div class="thumbs">${imgs.map((g, i) => `<button class="thumb${i === st.img ? ' on' : ''}" style="${thumbStyle(g.img, g.bg)}" data-act="img" data-i="${i}" aria-label="${t('Image {n}', { n: i + 1 })}"></button>`).join('')}</div>
        <div class="main-img">
          ${cur.img ? `<img class="bgfill photo" src="${esc(cur.img)}" alt="${esc(pName(p))}">` : `<div class="bgfill" style="background:${cur.bg}"></div>`}
          <div class="watermark"><img src="assets/logo-mark.png" alt=""></div>
          <span class="counter">${st.img + 1}/${imgs.length}</span>
          <button class="card-fav${fav ? ' on' : ''}" data-act="fav" data-id="${p.id}" aria-label="${t('Favourite')}">${icon('heart')}</button>
          ${p.flags.new ? `<span class="pill new">${t('NEW')}</span>` : ''}
          ${p.inStock ? '' : `<div class="oos"><span>${t('Out of stock')}</span></div>`}
          <div class="dots">${imgs.map((_, i) => `<i class="${i === st.img ? 'on' : ''}"></i>`).join('')}</div>
        </div>
      </div>
      <div>
        <div class="pdp-cat">${esc(prodCat(p))}</div>
        <h1 class="pdp-h1">${esc(pName(p))}</h1>
        <div class="pdp-price">${p.oldPrice && !o.setParts ? `<s>${money(p.oldPrice)}</s>` : ''}<span class="now"${p.oldPrice ? ' style="color:var(--sale)"' : ''}>${money(price)}</span>
          ${p.rating ? `<span class="stars">${stars(p.rating)}</span><span class="muted" style="font-size:12px">(${p.reviews})</span>` : ''}</div>
        <p class="pdp-desc">${esc(pDesc(p))}</p>
        <div class="specs">
          ${spec(t('Item'), esc(p.sub ? subName(p.cat, p.sub) : catName(p.cat)))}${spec(t('Code'), '#' + esc(p.code))}
          ${spec(t('Material'), esc(pMaterial(p) || '—'))}${spec(t('Size'), esc(pSize(p) || '—'))}
          ${spec(t('Color'), esc(pColor(p) || '—'))}${spec(t('Availability'), p.inStock ? (lowStock ? t('Only {n} left', { n: p.stock }) : t('In stock')) : t('Out of stock'))}
          ${comes.length ? spec(t('Comes with'), comes.map(esc).join(' · '), 'full lastrow') : ''}
        </div>
        ${opts}
        <div class="opt"><div class="opt-h"><span>${t('QUANTITY')}</span></div>
          <div class="qty"><button data-act="qty" data-d="-1" aria-label="${t('Decrease')}">−</button><span>${st.qty}</span><button data-act="qty" data-d="1" aria-label="${t('Increase')}">+</button></div></div>
        ${st.err ? `<div class="opt-err">${esc(st.err)}</div>` : ''}
        <div class="pdp-actions">
          <button class="btn btn-gold" data-act="addCart"${p.inStock ? '' : ' disabled'}>${p.inStock ? t('ADD TO CART') : t('OUT OF STOCK')}</button>
          <button class="btn btn-line" data-act="buyNow"${p.inStock ? '' : ' disabled'}>${t('CHECKOUT')}</button>
          <button class="fav-big${fav ? ' on' : ''}" data-act="fav" data-id="${p.id}" aria-label="${t('Favourite')}">${icon('heart')}</button>
        </div>
        <div class="perks"><div>✓ ${t('Complimentary gift wrap')}</div><div>✓ ${t('Pickup from Value 2 Mall')}</div><div>✓ ${t('Lifetime authenticity')}</div></div>
      </div>
    </section>
    ${rel.length ? `<section class="sec" style="padding-top:0;padding-bottom:96px">
      ${secHead(t('SELECTED FOR YOU'), t('You may also like'))}
      ${carousel('relTrack', rel.map(card))}
    </section>` : ''}`;
}

// cart & favourites -------------------------------------------------------------
function cartThumb(p) {
  return p.images && p.images.length ? `<div class="thumb-sm" style="${thumbStyle(p.images[0])}" data-act="open" data-id="${p.id}"></div>`
    : `<div class="thumb-sm" style="background:${p.bg}" data-act="open" data-id="${p.id}"></div>`;
}
function viewCart() {
  cleanCart();
  if (!S.cart.length) return `${pageHead([[t('Home'), '#/'], [t('Cart'), null]], t('My Cart'))}${emptyBlock(t('Your cart is empty.'), t('Discover pieces made to be treasured.'))}`;
  const tt = totals();
  const fees = deliveries().map(d => d.fee);
  const rows = S.cart.map((l, i) => {
    const p = byId(l.id);
    const unit = unitPrice(p, l.opts);
    const desc = [pMaterial(p), pSize(p), ...optText(l.opts, l.id)].filter(Boolean).map(esc).join('<br>');
    const short = !p.inStock || p.stock < l.qty;
    return `<tr><td class="muted">${i + 1}</td>
      <td><div style="display:flex;gap:16px;align-items:center">${cartThumb(p)}
        <div><div class="nm" data-act="open" data-id="${p.id}">${esc(pName(p))}</div><div class="desc">#${esc(p.code)}<br>${desc}${short ? `<br><b style="color:var(--sale)">${p.inStock ? t('Only {n} left', { n: p.stock }) : t('Out of stock')}</b>` : ''}</div></div></div></td>
      <td class="num hide-sm">${money(unit)}</td>
      <td><div class="qty sm"><button data-act="cartQty" data-key="${esc(l.key)}" data-d="-1" aria-label="${t('Decrease')}">−</button><span>${l.qty}</span><button data-act="cartQty" data-key="${esc(l.key)}" data-d="1" aria-label="${t('Increase')}">+</button></div></td>
      <td class="num">${money(unit * l.qty)}</td>
      <td><button class="rm" data-act="cartRm" data-key="${esc(l.key)}" aria-label="${t('Remove')}">✕</button></td></tr>`;
  }).join('');
  return `${pageHead([[t('Home'), '#/'], [t('Cart'), null]], t('My Cart'), n1(tt.count, '{n} item in your cart.', '{n} items in your cart.'))}
    <section class="narrow">
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>${t('ITEM')}</th><th class="hide-sm">${t('PRICE')}</th><th>${t('QTY')}</th><th>${t('TOTAL')}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="summary">${promoBox()}
        <div class="row"><span>${t('Subtotal')}</span><b>${money(tt.sub)}</b></div>
        <div class="row"><span>${t('Discount')}</span><b>${tt.disc ? '−' + money(tt.disc) : '—'}</b></div>
        <div class="row"><span>${t('Delivery fees')}</span><b>${fees.length ? t('From {p}', { p: money(Math.min(...fees)) }) + ' · ' : ''}${t('free pickup')}</b></div>
        <div class="row total"><span>${t('Estimated total')}</span><b>${money(tt.sub - tt.disc)}</b></div>
        <button class="btn btn-gold btn-block" style="margin-top:18px" data-act="go" data-href="#/checkout">${t('PROCEED TO CHECKOUT')} ${arrow()}</button>
        <div style="text-align:center;margin-top:16px"><button class="link-btn" data-act="go" data-href="#/shop/all">${t('CONTINUE SHOPPING')}</button></div>
      </div>
    </section>`;
}
function promoBox() {
  const m = S.ui.promoMsg;
  return `<form class="promo" data-form="promo"><input class="field" data-bind="promoInput" placeholder="${t('Discount code')}" value="${esc(S.promo ? S.promo.code : S.ui.promoInput)}"${S.promo ? ' disabled' : ''}>
    ${S.promo ? `<button type="button" class="btn btn-line" data-act="promoRm">${t('REMOVE')}</button>` : `<button class="btn btn-ink" type="submit">${t('APPLY')}</button>`}</form>
    ${m ? `<div class="promo-msg${m.err ? ' err' : ''}">${esc(m.text)}</div>` : ''}`;
}
function viewFavourites() {
  const favs = S.favs.map(byId).filter(Boolean);
  if (!favs.length) return `${pageHead([[t('Home'), '#/'], [t('Favourites'), null]], t('My Favourites'))}${emptyBlock(t('No favourites yet.'), t('Tap the ♡ on any piece to keep it here.'))}`;
  const rows = favs.map((p, i) => `<tr><td class="muted">${i + 1}</td>
    <td><div style="display:flex;gap:16px;align-items:center">${cartThumb(p)}
      <div><div class="nm" data-act="open" data-id="${p.id}">${esc(pName(p))}</div><div class="desc">#${esc(p.code)}<br>${esc(pMaterial(p))}<br>${[pSize(p), pColor(p)].filter(Boolean).map(esc).join(' · ')}</div></div></div></td>
    <td class="num hide-sm">${p.oldPrice ? `<s class="muted">${money(p.oldPrice)}</s><br>` : ''}${money(p.price)}</td>
    <td>${p.inStock ? `<button class="btn btn-ink" style="padding:11px 16px;font-size:10px" data-act="quick" data-id="${p.id}">${t('ADD TO CART')}</button>` : `<span class="muted" style="font-size:12px">${t('Out of stock')}</span>`}</td>
    <td><button class="rm" data-act="fav" data-id="${p.id}" aria-label="${t('Remove')}">✕</button></td></tr>`).join('');
  return `${pageHead([[t('Home'), '#/'], [t('Favourites'), null]], t('My Favourites'), n1(favs.length, '{n} saved piece.', '{n} saved pieces.'))}
    <section class="narrow"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>${t('ITEM')}</th><th class="hide-sm">${t('PRICE')}</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

// checkout ---------------------------------------------------------------------
const PAYMENTS = [
  ['instapay', 'InstaPay / Vodafone Cash', 'Transfer the order total, then send us the screenshot on WhatsApp to confirm your order.'],
  ['cod', 'Cash on delivery', 'Pay when your order arrives. For home delivery, the delivery fee is sent in advance via InstaPay / VC.'],
];
const payLabel = v => t((PAYMENTS.find(p => p[0] === v) || [])[1] || '');
const PHONE_RE = /^01[0125]\d{8}$/;
function coErrors(step) {
  const c = S.ui.co, f = c.form, e = {};
  if (step === 1) {
    if (!f.name || f.name.trim().length < 2) e.name = 1;
    if (!/^\S+@\S+\.\S+$/.test(f.email || '')) e.email = 1;
    if (!PHONE_RE.test((f.phone || '').replace(/\s/g, ''))) e.phone = 1;
    if (f.phone2 && !PHONE_RE.test(f.phone2.replace(/\s/g, ''))) e.phone2 = 1;
    if (c.fulfil === 'delivery') ['city', 'region', 'street', 'building'].forEach(k => { if (!(f[k] || '').trim()) e[k] = 1; });
  }
  if (step === 2 && !c.pay) e.pay = 1;
  return e;
}
function viewCheckout() {
  cleanCart();
  if (!S.cart.length) return viewCart();
  const c = S.ui.co, f = c.form, e = c.errors;
  if (S.user && !f._pre) Object.assign(f, { name: f.name || S.user.name, email: f.email || S.user.email, phone: f.phone || S.user.phone, _pre: 1 });
  const tt = totals({ city: f.city, fulfil: c.fulfil });
  const inp = (k, label, type = 'text', full = false, ph = '') => `<div class="${full ? 'full' : ''}"><label for="co-${k}">${label}</label>
    <input id="co-${k}" class="field${e[k] ? ' err' : ''}" type="${type}" data-bind="co.form.${k}" value="${esc(f[k] || '')}" placeholder="${ph}"></div>`;
  const step = (n, title, summary, body) => {
    const cls = c.step === n ? '' : (c.step > n ? 'done' : 'locked');
    return `<div class="step ${cls}"><button class="step-h" data-act="coStep" data-n="${n}"><span class="step-n">${c.step > n ? '✓' : n}</span><span class="t">${title}</span><span class="s">${c.step !== n ? summary : ''}</span></button>
      ${c.step === n ? `<div class="step-b">${body}</div>` : ''}</div>`;
  };

  const s1 = `<div class="frm">
      ${inp('name', t('Full name'), 'text', true)}${inp('email', t('Email'), 'email')}${inp('phone', t('Phone number'), 'tel', false, '01xxxxxxxxx')}
      ${inp('phone2', t('Another phone (optional)'), 'tel', false, '01xxxxxxxxx')}
    </div>
    <div style="margin-top:22px">
      <div class="choice${c.fulfil === 'delivery' ? ' on' : ''}" data-act="coFulfil" data-v="delivery"><span class="radio${c.fulfil === 'delivery' ? ' on' : ''}"></span><div><div class="ct">${t('Deliver to my address')}</div><div class="cs">${t('Delivery across Egypt · fees by city')}</div></div></div>
      <div class="choice${c.fulfil === 'pickup' ? ' on' : ''}" data-act="coFulfil" data-v="pickup"><span class="radio${c.fulfil === 'pickup' ? ' on' : ''}"></span><div><div class="ct">${t('Receive from our branch')}</div><div class="cs">${esc(sAddress())} · ${esc(sHours())}${STORE.mapsUrl ? ` · <a href="${esc(STORE.mapsUrl)}" target="_blank" rel="noopener" style="color:var(--gold)">${t('Location')} ↗</a>` : ''}</div></div></div>
    </div>
    ${c.fulfil === 'delivery' ? `<div class="frm" style="margin-top:12px">
      <div><label for="co-city">${t('City')}</label><select id="co-city" class="field${e.city ? ' err' : ''}" data-bind="co.form.city" data-rerender="1">
        <option value="">${t('Choose city')}</option>${deliveries().map(d => `<option value="${esc(d.city)}"${f.city === d.city ? ' selected' : ''}>${esc(cityName(d.city))} — ${money(d.fee)}</option>`).join('')}</select></div>
      ${inp('region', t('Region / area'))}${inp('street', t('Street'))}${inp('building', t('Building'))}${inp('apartment', t('Apartment / floor'))}
    </div>` : ''}
    <div class="frm" style="margin-top:14px"><div class="full"><label for="co-note">${t('Note (optional)')}</label><textarea id="co-note" class="field" style="min-height:80px" maxlength="1000" data-bind="co.form.note">${esc(f.note || '')}</textarea></div></div>
    ${Object.keys(e).length ? `<div class="form-err">${t('Please complete the highlighted fields.')}</div>` : ''}
    <div style="margin-top:20px;text-align:end"><button class="btn btn-ink" data-act="coNext" data-n="1">${t('NEXT: PAYMENT')} ${arrow()}</button></div>`;

  const s2 = PAYMENTS.map(([v, l, d]) => `<div class="choice${c.pay === v ? ' on' : ''}" data-act="coPay" data-v="${v}"><span class="radio${c.pay === v ? ' on' : ''}"></span><div><div class="ct">${t(l)}</div><div class="cs">${t(d)}</div></div></div>`).join('')
    + (e.pay ? `<div class="form-err">${t('Please choose a payment method.')}</div>` : '')
    + `<div style="margin-top:20px;text-align:end"><button class="btn btn-ink" data-act="coNext" data-n="2">${t('CONTINUE')} ${arrow()}</button></div>`;

  const mini = S.cart.map(l => { const p = byId(l.id); const ot = optText(l.opts, l.id); return `<div class="mini"><div class="th" style="${p.images && p.images.length ? thumbStyle(p.images[0]) : 'background:' + p.bg}"></div>
      <div><div class="nm">${esc(pName(p))}</div><div class="d">${t('Qty {n}', { n: l.qty })}${ot.length ? ' · ' + ot.map(esc).join(' · ') : ''}</div></div>
      <div class="pr">${money(unitPrice(p, l.opts) * l.qty)}</div></div>`; }).join('');
  const ready = c.step >= 3 && !!c.pay;

  return `${pageHead([[t('Home'), '#/'], [t('Cart'), '#/cart'], [t('Checkout'), null]], t('Place Your Order'))}
    <section class="co">
      <div>
        ${step(1, t('Your details'), f.name ? esc(f.name) + ' · ' + (c.fulfil === 'pickup' ? t('Branch pickup') : esc(cityName(f.city || ''))) : '', s1)}
        ${step(2, t('Payment'), esc(payLabel(c.pay)), s2)}
        ${!S.user ? `<div class="muted" style="font-size:12px;line-height:1.7">${t('Checking out as a guest — you can track your order with its number and your phone.')} <button class="link-btn" style="font-size:11px" data-act="go" data-href="#/account">${t('SIGN IN')}</button></div>` : ''}
      </div>
      <aside class="co-side"><div class="summary" style="margin-top:0">
        <div class="serif" style="font-size:26px;margin-bottom:6px">${t('My Cart')}</div>
        ${mini}
        <div style="margin-top:18px">${promoBox()}</div>
        <div class="row"><span>${t('Subtotal')}</span><b>${money(tt.sub)}</b></div>
        <div class="row"><span>${t('Discount')}${S.promo ? ' (' + esc(S.promo.code) + ')' : ''}</span><b>${tt.disc ? '−' + money(tt.disc) : '—'}</b></div>
        <div class="row"><span>${t('Delivery fees')}</span><b>${tt.del == null ? t('Choose city') : tt.del === 0 ? t('Free') : money(tt.del)}</b></div>
        <div class="row total"><span>${t('Total')}</span><b>${money(tt.total)}</b></div>
        ${c.msg ? `<div class="form-err">${esc(c.msg)}</div>` : ''}
        <button class="btn btn-gold btn-block" style="margin-top:18px" data-act="placeOrder"${ready && !c.busy ? '' : ' disabled'}>${c.busy ? t('PLACING ORDER…') : t('BUY NOW')}</button>
        ${ready ? '' : `<div class="muted" style="font-size:11px;text-align:center;margin-top:10px">${t('Complete the steps to place your order.')}</div>`}
      </div></aside>
    </section>`;
}
async function placeOrder() {
  const c = S.ui.co;
  for (const n of [1, 2]) {
    const e = coErrors(n);
    if (Object.keys(e).length) { c.errors = e; c.step = n; c.msg = ''; return render(); }
  }
  const f = c.form;
  const payload = {
    customer: { name: f.name.trim(), email: f.email.trim(), phone: f.phone.replace(/\s/g, ''), phone2: (f.phone2 || '').replace(/\s/g, '') },
    fulfil: c.fulfil, city: c.fulfil === 'delivery' ? f.city : null,
    address: { region: f.region, street: f.street, building: f.building, apartment: f.apartment },
    note: f.note || '', payment: c.pay, promo: S.promo ? S.promo.code : null,
    items: S.cart.map(l => ({ id: l.id, qty: l.qty, opts: l.opts })),
  };
  c.busy = true; c.msg = ''; render();
  try {
    const res = await API.placeOrder(payload);
    track('order_placed', { path: '/checkout' });
    S.receipts = [res, ...S.receipts.filter(r => r.order_no !== res.order_no)].slice(0, 10);
    S.cart = []; S.promo = null; S.ui.promoMsg = null;
    S.ui.co = { step: 1, form: {}, fulfil: 'delivery', pay: '', errors: {}, msg: '', busy: false };
    save('receipts', 'cart', 'promo'); updateBadges();
    if (S.user) { S.ui.open[res.order_no] = true; loadOrders(); }
    location.hash = '#/order/' + res.order_no;
  } catch (err) {
    c.busy = false; c.msg = API.errMessage(err);
    if (/^INVALID:promo/.test(err.message)) { S.promo = null; save('promo'); }
    if (/^(OUT_OF_STOCK|NOT_FOUND)/.test(err.message)) refreshCatalog();
    render();
  }
}
function paymentNote(o) {
  const amount = o.payment === 'instapay' ? o.total : o.delivery_fee;
  if (o.payment_status !== 'awaiting' || !amount) return '';
  const msg = o.payment === 'instapay'
    ? t('Please send the order total, {amount}, to {number} on InstaPay or Vodafone Cash, then send a screenshot in our WhatsApp chat to confirm your order.', { amount: `<b>${money(amount)}</b>`, number: `<b>${esc(STORE.instapay)}</b>` })
    : t('Please send the delivery fees ({amount}) to {number} on InstaPay or Vodafone Cash, then send a screenshot in our WhatsApp chat to confirm your order. The rest is paid on delivery.', { amount: `<b>${money(amount)}</b>`, number: `<b>${esc(STORE.instapay)}</b>` });
  const wa = t('Hello ALLURE, I placed order {no} ({total}). Here is my payment screenshot:', { no: o.order_no, total: money(o.total) });
  return `<div class="notice">${msg}
    <div><a class="btn btn-gold wa" href="${waLink(wa)}" target="_blank" rel="noopener">${icon('whatsapp')} ${t('OPEN WHATSAPP CHAT')}</a></div></div>`;
}
function viewOrderPlaced(no) {
  const o = S.receipts.find(x => x.order_no === no) || S.orders.find(x => x.order_no === no);
  if (!o) return viewTrack(no);
  const name = (o.customer && o.customer.name || '').split(' ')[0];
  return `<section class="confirm">
    <div class="seal">✓</div>
    <div class="eyebrow">${t('ORDER {no}', { no: esc(o.order_no) })}</div>
    <h1 class="page-h1" style="margin-top:12px">${name ? t('Thank you, {name}.', { name: esc(name) }) : t('Thank you.')}</h1>
    <p class="page-sub">${t('Your order is {status} until we confirm it. Keep your order number {no} to track it.', { status: `<b style="color:var(--gold)">${t('Pending')}</b>`, no: `<b>${esc(o.order_no)}</b>` })}</p>
    ${paymentNote(o)}
    <div class="summary" style="text-align:start">
      ${(o.items || []).map(i => { const ot = optText(i.opts, i.id); return `<div class="row"><span>${i.qty} × ${esc(itemName(i))}${ot.length ? ` <span style="font-size:11px">(${ot.map(esc).join(isAr() ? '، ' : ', ')})</span>` : ''}</span><b>${money(i.unit * i.qty)}</b></div>`; }).join('')}
      ${o.discount ? `<div class="row"><span>${t('Discount')}</span><b>−${money(o.discount)}</b></div>` : ''}
      <div class="row"><span>${o.fulfil === 'pickup' ? t('Branch pickup') : t('Delivery')}</span><b>${o.delivery_fee ? money(o.delivery_fee) : t('Free')}</b></div>
      <div class="row total"><span>${t('Total')}</span><b>${money(o.total)}</b></div>
    </div>
    <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:28px">
      <button class="btn btn-ink" data-act="go" data-href="${S.user ? '#/orders' : '#/track/' + o.order_no}">${t('TRACK MY ORDER')}</button>
      <button class="btn btn-line" data-act="go" data-href="#/shop/all">${t('CONTINUE SHOPPING')}</button>
    </div>
  </section>`;
}

// tracking ---------------------------------------------------------------------
const STATUS_LBL = { cart: 'My Cart', pending: 'Pending', shipped: 'Shipped', received: 'Received', cancelled: 'Cancelled' };
const statusPill = s => `<span class="status ${s}">${t(STATUS_LBL[s] || s)}</span>`;
function timeline(o) {
  const steps = o.status === 'cancelled' ? ['cart', 'pending', 'cancelled'] : ['cart', 'pending', 'shipped', 'received'];
  const cur = steps.indexOf(o.status);
  const h = o.history || {};
  return `<ul class="timeline">${steps.map((k, i) => {
    const cls = i < cur ? 'done' : i === cur ? 'cur' + (k === 'cancelled' ? ' x' : '') : '';
    return `<li class="${cls}">${t(STATUS_LBL[k])}${h[k] ? `<small>${fmtDate(h[k], true)}</small>` : ''}</li>`;
  }).join('')}</ul>`;
}
const PAY_STATUS = { awaiting: 'Awaiting InstaPay transfer', confirmed: 'Payment confirmed', not_required: 'Pay on pickup' };
function orderDetails(o) {
  const items = (o.items || []).map(i => { const ot = optText(i.opts, i.id); return `<div class="mini"><div class="th" style="${i.image ? thumbStyle(i.image) : 'background:' + i.bg}"></div><div><div class="nm">${esc(itemName(i))}</div>
      <div class="d">#${esc(i.code)} · ${t('Qty {n}', { n: i.qty })}${ot.length ? ' · ' + ot.map(esc).join(' · ') : ''}</div></div><div class="pr">${money(i.unit * i.qty)}</div></div>`; }).join('');
  return `<div class="order-body"><div>${timeline(o)}</div>
    <div>${items}<div class="muted" style="font-size:12px;margin-top:14px;line-height:1.8">${o.fulfil === 'pickup' ? t('Pickup:') : t('Deliver to:')} ${esc(o.address)}<br>
      ${t('Payment:')} ${esc(payLabel(o.payment))} · ${esc(t(PAY_STATUS[o.payment_status] || ''))}<br>${t('Total:')} <b style="color:var(--ink)">${money(o.total)}</b></div>
      ${o.status === 'pending' ? paymentNote(o) : ''}</div></div>`;
}
function viewTrack(prefill) {
  const tr = S.ui.track;
  if (prefill && !tr.no) tr.no = prefill;
  const r = tr.result;
  return `${pageHead([[t('Home'), '#/'], [t('Track an Order'), null]], t('Track Your Order'), t('Enter your order number and the phone number used at checkout.'))}
    <section class="narrow" style="max-width:820px">
      <form class="summary" style="margin-top:0" data-form="track"><div class="frm">
        <div><label for="tr-no">${t('Order number')}</label><input id="tr-no" class="field" placeholder="AL10231" data-bind="track.no" value="${esc(tr.no)}"></div>
        <div><label for="tr-ph">${t('Phone')}</label><input id="tr-ph" class="field" type="tel" placeholder="01xxxxxxxxx" data-bind="track.phone" value="${esc(tr.phone)}"></div>
      </div>
      ${tr.msg ? `<div class="form-err">${esc(tr.msg)}</div>` : ''}
      <button class="btn btn-gold" style="margin-top:20px" type="submit"${busyAttr(tr.busy)}>${tr.busy ? t('SEARCHING…') : t('TRACK ORDER')}</button></form>
      ${r ? `<div class="order" style="margin-top:24px"><div class="order-top"><div><div class="id">${esc(r.order_no)}</div><div class="meta">${fmtDate(r.created_at)} · ${money(r.total)}</div></div>${statusPill(r.status)}</div>${orderDetails(r)}</div>` : ''}
      ${S.user ? '' : `<p class="muted" style="font-size:13px;margin-top:22px">${t('Have an account?')} <button class="link-btn" data-act="go" data-href="#/account">${t('SIGN IN')}</button> ${t('to see all your orders.')}</p>`}
    </section>`;
}

// account & orders -----------------------------------------------------------------
function orderCard(o, ongoing) {
  const open = S.ui.open[o.order_no];
  const pieces = (o.items || []).reduce((a, i) => a + i.qty, 0);
  return `<div class="order">
    <div class="order-top"><div><div class="id">${esc(o.order_no)}</div><div class="meta">${fmtDate(o.created_at)} · ${n1(pieces, '{n} item', '{n} items')} · ${money(o.total)}</div></div>
      ${statusPill(o.status)}
      <button class="btn ${ongoing ? 'btn-gold' : 'btn-line'}" data-act="orderToggle" data-id="${esc(o.order_no)}">${open ? t('HIDE') : ongoing ? t('TRACK ORDER') : t('VIEW ORDER')}</button></div>
    ${open ? orderDetails(o) : ''}
  </div>`;
}
function viewAuth() {
  const a = S.ui.auth, f = a.form, m = a.mode;
  const field = (k, label, type = 'text', ph = '') => `<div class="full"><label for="au-${k}">${label}</label><input id="au-${k}" class="field" type="${type}" placeholder="${ph}" data-bind="auth.form.${k}" value="${type === 'password' ? '' : esc(f[k] || '')}" autocomplete="${{ email: 'email', password: m === 'signup' ? 'new-password' : 'current-password', name: 'name', phone: 'tel' }[k] || 'off'}"></div>`;
  const body = m === 'forgot'
    ? `${field('email', t('Email'), 'email')}`
    : m === 'signup'
      ? `${field('name', t('Full name'))}${field('phone', t('Phone'), 'tel', '01xxxxxxxxx')}${field('email', t('Email'), 'email')}${field('password', t('Password (6+ characters)'), 'password')}`
      : `${field('email', t('Email'), 'email')}${field('password', t('Password'), 'password')}`;
  const label = { signin: t('SIGN IN'), signup: t('CREATE ACCOUNT'), forgot: t('SEND RESET LINK') }[m];
  return `${pageHead([[t('Home'), '#/'], [t('My Account'), null]], t('My Account'), t('Sign in to track your orders and share your feedback.'))}
    <section class="narrow" style="max-width:560px">
      ${m !== 'forgot' ? `<div class="tabs"><button class="${m === 'signin' ? 'on' : ''}" data-act="authMode" data-m="signin">${t('SIGN IN')}</button><button class="${m === 'signup' ? 'on' : ''}" data-act="authMode" data-m="signup">${t('CREATE ACCOUNT')}</button></div>` : ''}
      <form class="summary" style="margin-top:0" data-form="auth">
        ${m === 'forgot' ? `<div class="serif" style="font-size:24px;margin-bottom:14px">${t('Reset your password')}</div>` : ''}
        <div class="frm">${body}</div>
        ${a.msg ? `<div class="form-err">${esc(a.msg)}</div>` : ''}
        ${a.ok ? `<div class="promo-msg" style="margin:14px 0 0">${esc(a.ok)}</div>` : ''}
        <button class="btn btn-gold btn-block" style="margin-top:22px" type="submit"${busyAttr(a.busy)}>${a.busy ? t('PLEASE WAIT…') : label}</button>
        <div style="text-align:center;margin-top:16px">${m === 'forgot'
          ? `<button type="button" class="link-btn" data-act="authMode" data-m="signin">${t('BACK TO SIGN IN')}</button>`
          : m === 'signin' ? `<button type="button" class="link-btn" data-act="authMode" data-m="forgot">${t('FORGOT PASSWORD?')}</button>` : ''}</div>
      </form>
      <p class="muted" style="font-size:13px;text-align:center;margin-top:22px">${t('Ordered as a guest?')} <button class="link-btn" data-act="go" data-href="#/track">${t('TRACK AN ORDER')}</button></p>
    </section>`;
}
function viewAccount(tab) {
  if (tab) S.ui.acctTab = tab;
  const u = S.user;
  if (!u) return viewAuth();
  const tb = S.ui.acctTab;
  const ongoing = S.orders.filter(o => o.status === 'pending' || o.status === 'shipped');
  const prev = S.orders.filter(o => o.status === 'received' || o.status === 'cancelled');
  const p = S.ui.profile || (S.ui.profile = { name: u.name, phone: u.phone });
  const body = tb === 'orders' ? `
      <div class="grp-h">${t('ONGOING ORDERS')} <span>${ongoing.length}</span></div>
      ${ongoing.length ? ongoing.map(o => orderCard(o, true)).join('') : `<div class="muted" style="font-size:14px;padding:10px 0 20px">${t('No ongoing orders.')} <button class="link-btn" data-act="go" data-href="#/shop/all">${t('START SHOPPING')}</button></div>`}
      <div class="grp-h"><button data-act="prevToggle">${t('PREVIOUS ORDERS')} <span style="color:var(--gold)">${S.ui.prevOpen ? '▲' : '▼'}</span></button><span>${prev.length}</span></div>
      ${S.ui.prevOpen ? (prev.length ? prev.map(o => orderCard(o, false)).join('') : `<div class="muted" style="font-size:14px">${t('No previous orders yet.')}</div>`) : ''}`
    : `<form class="summary" style="margin-top:0" data-form="profile"><div class="frm">
        <div class="full"><label for="pf-name">${t('Name')}</label><input id="pf-name" class="field" data-bind="profile.name" value="${esc(p.name)}"></div>
        <div><label for="pf-phone">${t('Phone')}</label><input id="pf-phone" class="field" type="tel" data-bind="profile.phone" value="${esc(p.phone)}"></div>
        <div><label for="pf-email">${t('Email')}</label><input id="pf-email" class="field" type="email" value="${esc(u.email)}" disabled></div>
      </div>
      ${S.ui.profileMsg ? `<div class="promo-msg" style="margin:14px 0 0">${esc(S.ui.profileMsg)}</div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:22px;gap:12px;flex-wrap:wrap">
        <button class="btn btn-gold" type="submit">${t('SAVE CHANGES')}</button>
        <button class="btn btn-line" type="button" data-act="go" data-href="#/orders">${t('MY ORDERS')} ${arrow()}</button>
      </div></form>
      <div style="text-align:center;margin-top:26px"><button class="link-btn" data-act="signOut">${t('SIGN OUT')}</button></div>`;
  return `<section class="acct-cover"><div class="bgfill"></div><div class="wrap">
      <div class="avatar">${esc((u.name || u.email).trim().charAt(0).toUpperCase())}</div>
      <div><div class="eyebrow" style="color:#e6cd97">${t('MY ACCOUNT')}</div><h1>${esc(u.name || t('Welcome'))}</h1><p>${esc(u.email)}${u.phone ? ' · ' + esc(u.phone) : ''}</p></div>
    </div></section>
    <section class="narrow" style="padding-top:36px">
      <div class="tabs"><button class="${tb === 'profile' ? 'on' : ''}" data-act="go" data-href="#/account">${t('EDIT PROFILE')}</button><button class="${tb === 'orders' ? 'on' : ''}" data-act="go" data-href="#/orders">${t('MY ORDERS')}</button></div>
      ${body}
    </section>`;
}
function viewReset() {
  const r = S.ui.reset;
  return `${pageHead([[t('Home'), '#/'], [t('New Password'), null]], t('Choose a New Password'))}
    <section class="narrow" style="max-width:520px">
      <form class="summary" style="margin-top:0" data-form="reset">
        <div class="frm"><div class="full"><label for="rs-pw">${t('New password (6+ characters)')}</label><input id="rs-pw" class="field" type="password" autocomplete="new-password" data-bind="reset.pw"></div></div>
        ${r.msg ? `<div class="form-err">${esc(r.msg)}</div>` : ''}${r.ok ? `<div class="promo-msg" style="margin:14px 0 0">${esc(r.ok)}</div>` : ''}
        <button class="btn btn-gold btn-block" style="margin-top:22px" type="submit">${t('SAVE PASSWORD')}</button>
      </form></section>`;
}

// content pages ---------------------------------------------------------------------
function viewPage(slugName) {
  const so = STORE.socials || {};
  const socials = `${so.facebook ? `<a href="${esc(so.facebook)}" target="_blank" rel="noopener" aria-label="Facebook">${icon('facebook')}</a>` : ''}${so.instagram ? `<a href="${esc(so.instagram)}" target="_blank" rel="noopener" aria-label="Instagram">${icon('instagram')}</a>` : ''}${so.tiktok ? `<a href="${esc(so.tiktok)}" target="_blank" rel="noopener" aria-label="TikTok">${icon('tiktok')}</a>` : ''}`;
  const home = [t('Home'), '#/'];
  const P = {
    about: () => `<section class="hero" style="min-height:420px"><div class="hero-bg" style="background:linear-gradient(120deg,#241f1a,#5a4a36 70%,#bca073)"></div><div class="hero-shade" style="background:rgba(8,6,4,0.4)"></div>
        <div class="wrap" style="text-align:center"><div class="hero-kicker">${t('OUR STORY')}</div><h1 class="hero-h1" style="font-size:64px">${t('About ALLURE Boutique')}</h1>
        <p class="hero-p" style="margin:24px auto 0;max-width:560px">${t("Women's accessories, dedicated to helping you stay elegant. Be different, anytime anywhere.")}</p></div></section>
      <section class="about-quote"><p>${t('Founded in New Cairo, ALLURE began with a simple belief — that {em} lives in the details. From Italian-inspired gold to contemporary silhouettes, every piece is handpicked to help you express your unique style.', { em: `<em>${t('true luxury')}</em>` })}</p></section>
      <section class="about-content"><div style="position:relative;aspect-ratio:4/3;background:linear-gradient(150deg,#d9c9b3,#9c8164)"><span class="card-tag" style="font-size:9px">BOUTIQUE INTERIOR</span></div>
        <div><h2 class="h2" style="font-size:40px">${t('Handpicked, authenticated, yours.')}</h2>
        <p class="pdp-desc">${t("Each item passes through our authentication studio before it reaches you. No replicas, no compromises — only pieces we'd wear ourselves.")}</p>
        <div class="stats"><div><div class="n">1,800+</div><div class="l">${t('PRODUCTS')}</div></div><div><div class="n">16.8K</div><div class="l">${t('FOLLOWERS')}</div></div><div><div class="n">100%</div><div class="l">${t('AUTHENTIC')}</div></div></div></div></section>
      <section class="band"><div class="values">
        <div><div class="g">✶</div><h3>${t('Curated Selection')}</h3><p>${t('A tight edit of bags, sunglasses, jewelry and watches — nothing filler.')}</p></div>
        <div><div class="g">✦</div><h3>${t('Verified Authentic')}</h3><p>${t('Every piece authenticated in-house and guaranteed for life.')}</p></div>
        <div><div class="g">❖</div><h3>${t('Concierge Service')}</h3><p>${t('Personal styling and delivery across New Cairo and beyond.')}</p></div></div></section>`,
    contact: () => `${pageHead([home, [t('Contact Us'), null]], t('Contact Us'), t('We usually reply within a few hours.'))}
      <section class="prose" style="max-width:1100px"><div class="info-grid">
        <div class="info-card"><div class="k">${t('WHATSAPP')}</div><div class="v" dir="ltr">${esc(STORE.phone)}</div><a class="btn btn-gold wa" style="padding:12px 18px" href="https://wa.me/${esc(STORE.whatsapp)}" target="_blank" rel="noopener">${icon('whatsapp')} ${t('CHAT NOW')}</a></div>
        <div class="info-card"><div class="k">${t('EMAIL')}</div><div class="v">${esc(STORE.email)}</div></div>
        <div class="info-card"><div class="k">${t('FOLLOW US')}</div><div class="socials" style="margin-top:14px">${socials}</div></div>
      </div></section>`,
    location: () => `${pageHead([home, [t('Visit Us'), null]], t('Visit Us'), t('Come see every piece in person.'))}
      <section class="prose" style="max-width:1100px"><div class="info-grid">
        <div class="info-card"><div class="k">${t('BOUTIQUE')}</div><div class="v">${esc(sAddress())}</div></div>
        <div class="info-card"><div class="k">${t('OPENING HOURS')}</div><div class="v">${esc(sHours())}</div></div>
        <div class="info-card"><div class="k">${t('DIRECTIONS')}</div><div class="v">${STORE.mapsUrl ? `<a href="${esc(STORE.mapsUrl)}" target="_blank" rel="noopener" style="color:var(--gold)">${t('Open in Google Maps')} ↗</a>` : '—'}</div></div>
      </div><p style="margin-top:30px">${t('You can also choose {opt} at checkout and collect your order from the boutique at no delivery cost.', { opt: `<b>${t('Receive from our branch')}</b>` })}</p></section>`,
    policy: () => `${pageHead([home, [t('Our Policy'), null]], t('Our Policy'))}
      <section class="prose"><h2>${t('Authenticity')}</h2><p>${t('Every piece sold by ALLURE Boutique is inspected before it reaches you.')}</p>
      <h2>${t('Exchanges & returns')}</h2><ul><li>${t('Exchanges are accepted within 14 days of receiving your order, provided the item is unworn and in its original packaging.')}</li><li>${t('Earrings and personalised pieces (such as initial necklaces) cannot be exchanged for hygiene and personalisation reasons.')}</li><li>${t('Sale items can be exchanged but not refunded.')}</li></ul>
      <h2>${t('Orders')}</h2><p>${t('Orders stay Pending until we confirm them. Orders paid by InstaPay or Vodafone Cash are confirmed once we receive your payment screenshot on WhatsApp.')}</p></section>`,
    shipping: () => `${pageHead([home, [t('Shipping Policy'), null]], t('Shipping Policy'))}
      <section class="prose"><h2>${t('Delivery fees')}</h2><ul>${deliveries().map(d => `<li>${esc(cityName(d.city))}: ${money(d.fee)}</li>`).join('')}<li>${t('Pickup from our branch ({address}): free', { address: esc(sAddress()) })}</li></ul>
      <h2>${t('Delivery time')}</h2><p>${t('Cairo and Giza orders usually arrive within 2–3 working days; other governorates within 3–5 working days.')}</p>
      <h2>${t('Cash on delivery')}</h2><p>${t('For cash-on-delivery orders, the delivery fees are paid in advance via InstaPay or Vodafone Cash to confirm the order.')}</p></section>`,
    terms: () => `${pageHead([home, [t('Terms of Service'), null]], t('Terms of Service'))}
      <section class="prose"><p>${t('By placing an order with ALLURE Boutique you agree to the following terms.')}</p>
      <h2>${t('Prices & payment')}</h2><p>${t('Prices are shown in Egyptian pounds (LE). We accept InstaPay / Vodafone Cash transfers and cash on delivery.')}</p>
      <h2>${t('Availability')}</h2><p>${t('Pieces are handpicked and often limited. If an item becomes unavailable after you order, we will contact you to offer an alternative or a refund.')}</p>
      <h2>${t('Accounts & reviews')}</h2><p>${t('You need to be signed in to submit feedback. Reviews are published after approval; we may remove reviews that are offensive or unrelated to our products.')}</p></section>`,
  };
  return (P[slugName] || viewNotFound)();
}
const viewNotFound = () => `<div class="empty" style="padding:120px 16px"><span class="serif">${t('This page could not be found.')}</span><div style="margin-top:22px"><button class="btn btn-gold" data-act="go" data-href="#/">${t('BACK TO HOME')}</button></div></div>`;
const viewLoading = () => `<div class="empty" style="padding:160px 16px"><span class="serif">ALLURE</span>${t('Loading the collection…')}</div>`;
const viewSetup = () => `<div class="confirm"><div class="eyebrow">${t('SETUP NEEDED')}</div><h1 class="page-h1" style="margin-top:12px">${t('Store not connected yet')}</h1>
  <p class="page-sub">${t('Add your Supabase project URL and anon key to config.js — see SETUP.md, step 1.')}</p></div>`;
const viewError = () => `<div class="confirm"><div class="eyebrow">${t('CONNECTION PROBLEM')}</div><h1 class="page-h1" style="margin-top:12px">${t("We couldn't load the shop")}</h1>
  <p class="page-sub">${esc(S.loadError)}</p><div style="margin-top:22px"><button class="btn btn-gold" data-act="reload">${t('TRY AGAIN')}</button></div></div>`;

// ───────────────────────── router ─────────────────────────
let lastPath = null;
function route() {
  if (!API.ready) return viewSetup();
  if (S.loadError) return viewError();
  const h = location.hash;
  if (S.loading || /access_token=|error_description=|type=recovery/.test(h)) return viewLoading();
  const [a, b, c] = (h.replace(/^#\/?/, '') || '').split('/').map(decodeURIComponent);
  switch (a) {
    case '': case undefined: return viewHome();
    case 'reviews': return viewHome();
    case 'shop': return viewListing(b || 'all', c);
    case 'search': return viewListing('search', null, b || '');
    case 'product': return viewProduct(b);
    case 'cart': return viewCart();
    case 'favourites': return viewFavourites();
    case 'checkout': return viewCheckout();
    case 'order': return viewOrderPlaced(b);
    case 'track': return viewTrack(b);
    case 'account': return viewAccount('profile');
    case 'orders': return viewAccount('orders');
    case 'reset': return viewReset();
    case 'page': return viewPage(b);
    default: return viewNotFound();
  }
}
function render() {
  const path = location.hash;
  const changed = path !== lastPath && !(path.startsWith('#/search/') && (lastPath || '').startsWith('#/search/'));
  if (changed && /^#\/(shop|search)/.test(path) && path.split('/').slice(0, 3).join('/') !== (lastPath || '').split('/').slice(0, 3).join('/')) {
    S.ui.filter = emptyFilter(); S.ui.sortOpen = false;
  }
  const y = window.scrollY;
  $('#app').innerHTML = `<div class="view"${changed ? '' : ' style="animation:none"'}>${route()}</div>`;
  lastPath = path;
  if (changed) {
    if (path === '#/reviews') { const r = $('#reviews'); if (r) r.scrollIntoView(); } else window.scrollTo(0, 0);
  } else window.scrollTo(0, y);
  document.documentElement.setAttribute('data-theme', S.theme);
  if (S.ui.filterOpen) renderFilters();
  if (API.ready && !S.loading && !S.loadError && !/access_token=|type=recovery/.test(path)) { trackRoute(); presenceUpdate(); }
}
function closeDrawers() {
  S.ui.menu = false; S.ui.filterOpen = false;
  $('#menu').classList.remove('open'); $('#filters').classList.remove('open'); $('#scrim').classList.remove('open');
}
function setTitle() { document.title = t('ALLURE Boutique — Be different, anytime anywhere'); }

// ───────────────────────── data loading ─────────────────────────
function applyCatalog({ settings, products, reviews }) {
  STORE = settings || {}; CATEGORIES = STORE.categories || []; PRODUCTS = products; REVIEWS = reviews;
}
async function refreshCatalog() {
  try { applyCatalog(await API.catalog()); render(); } catch (e) { /* keep showing what we have */ }
}
async function loadOrders() {
  if (!S.user) { S.orders = []; return; }
  try { S.orders = await API.myOrders(); } catch (e) { S.orders = []; }
  render();
}
let orderChannel = null;
async function onSession(session) {
  if (session) {
    try { S.user = await API.profile(); } catch (e) { S.user = null; }
    if (S.user && !S.user.email) S.user.email = session.user.email;
    await loadOrders();
    if (!orderChannel) orderChannel = API.subscribeOrders('my-orders', () => loadOrders());
  } else {
    S.user = null; S.orders = []; S.ui.profile = null;
    if (orderChannel) { API.sb.removeChannel(orderChannel); orderChannel = null; }
  }
  setTracking(!(S.user && S.user.role === 'admin'));
  renderMenu(); render();
}

// ───────────────────────── events ─────────────────────────
function setPath(obj, path, val) { const k = path.split('.'); let o = obj; k.slice(0, -1).forEach(x => { o = o[x] = o[x] || {}; }); o[k[k.length - 1]] = val; }

const ACTIONS = {
  go: el => { closeDrawers(); const h = el.dataset.href; if (location.hash === h) render(); else location.hash = h; },
  open: el => { location.hash = '#/product/' + el.dataset.id; },
  fav: el => { toggleFav(el.dataset.id); render(); },
  quick: el => {
    const p = byId(el.dataset.id); if (!p || !p.inStock) return;
    if (needsOptions(p)) { location.hash = '#/product/' + p.id; toast(t('Choose your options first')); return; }
    addToCart(p.id); toast(t('{name} added to cart', { name: pName(p) }), t('VIEW CART'), '#/cart');
  },
  menu: () => { renderMenu(); S.ui.menu = true; $('#menu').classList.add('open'); $('#scrim').classList.add('open'); },
  menuCats: () => { S.ui.cats = !S.ui.cats; renderMenu(); },
  menuCat: el => { const c = el.dataset.cat; S.ui.openCat[c] = !S.ui.openCat[c]; renderMenu(); },
  closeDrawers,
  search: () => { S.ui.search = !S.ui.search; renderHeader(); if (S.ui.search) $('#q').focus(); },
  theme: () => { S.theme = S.theme === 'dark' ? 'light' : 'dark'; save('theme'); document.documentElement.setAttribute('data-theme', S.theme); renderHeader(); if (S.ui.menu) renderMenu(); },
  lang: () => {
    I18N.set(isAr() ? 'en' : 'ar'); setTitle();
    renderHeader(); renderFooter(); renderMenu(); if (S.ui.filterOpen) renderFilters();
    lastPath = location.hash; render(); presenceUpdate();
  },
  car: el => { const tr = document.getElementById(el.dataset.target); if (tr) tr.scrollBy({ left: tr.clientWidth * 0.8 * +el.dataset.dir * (isAr() ? -1 : 1), behavior: 'smooth' }); },
  reload: () => location.reload(),
  // listing
  sortToggle: () => { S.ui.sortOpen = !S.ui.sortOpen; render(); },
  sort: el => { S.ui.sort = el.dataset.v; S.ui.sortOpen = false; render(); },
  filterOpen: () => { S.ui.draft = JSON.parse(JSON.stringify(S.ui.filter)); S.ui.filterOpen = true; renderFilters(); $('#filters').classList.add('open'); $('#scrim').classList.add('open'); },
  filterClear: () => { S.ui.draft = emptyFilter(); renderFilters(); },
  filterApply: () => { S.ui.filter = S.ui.draft; closeDrawers(); render(); },
  filterClearAll: () => { S.ui.filter = emptyFilter(); render(); },
  rmFilter: el => {
    const k = el.dataset.k, f = S.ui.filter;
    if (k === 'avail') { f.inStock = f.outStock = false; } else if (k === 'price') { f.min = f.max = ''; } else f.cats = f.cats.filter(c => 'cat:' + c !== k);
    render();
  },
  // product
  img: el => { S.ui.pdp.img = +el.dataset.i; render(); },
  opt: el => { S.ui.pdp.opts[el.dataset.k] = el.dataset.v; S.ui.pdp.err = ''; render(); },
  part: el => { const o = S.ui.pdp.opts, v = el.dataset.v; o.parts = o.parts || []; o.parts = o.parts.includes(v) ? o.parts.filter(x => x !== v) : [...o.parts, v]; S.ui.pdp.err = ''; render(); },
  qty: el => { const p = byId(S.ui.pdp.id); S.ui.pdp.qty = Math.max(1, Math.min(10, p ? p.stock : 10, S.ui.pdp.qty + +el.dataset.d)); render(); },
  addCart: () => { if (pdpAdd()) toast(t('Added to cart'), t('VIEW CART'), '#/cart'); },
  buyNow: () => { if (pdpAdd()) location.hash = '#/checkout'; },
  // cart
  cartQty: el => { const l = S.cart.find(x => x.key === el.dataset.key); if (!l) return; l.qty = Math.max(1, Math.min(10, l.qty + +el.dataset.d)); save('cart'); updateBadges(); render(); },
  cartRm: el => { S.cart = S.cart.filter(x => x.key !== el.dataset.key); save('cart'); updateBadges(); render(); },
  promoRm: () => { S.promo = null; S.ui.promoMsg = null; save('promo'); render(); },
  // checkout
  coStep: el => { const n = +el.dataset.n; if (n < S.ui.co.step) { S.ui.co.step = n; S.ui.co.errors = {}; render(); } },
  coFulfil: el => { S.ui.co.fulfil = el.dataset.v; render(); },
  coPay: el => { S.ui.co.pay = el.dataset.v; S.ui.co.errors = {}; render(); },
  coNext: el => {
    const n = +el.dataset.n, e = coErrors(n); S.ui.co.errors = e;
    if (!Object.keys(e).length) S.ui.co.step = n + 1;
    render();
  },
  placeOrder,
  // account
  authMode: el => { S.ui.auth = { mode: el.dataset.m, form: { email: S.ui.auth.form.email }, msg: '', ok: '', busy: false }; render(); },
  orderToggle: el => { S.ui.open[el.dataset.id] = !S.ui.open[el.dataset.id]; render(); },
  prevToggle: () => { S.ui.prevOpen = !S.ui.prevOpen; render(); },
  signOut: async () => { await API.auth.signOut(); location.hash = '#/account'; },
  star: el => { S.ui.fb.rating = +el.dataset.n; S.ui.fb.msg = ''; S.ui.fb.ok = ''; render(); },
};
function pdpAdd() {
  const st = S.ui.pdp, p = byId(st.id), o = p.options || {}, miss = [];
  if (o.colors && !st.opts.color) miss.push(t('color'));
  if (o.letters && !st.opts.letter) miss.push(t('letter'));
  if (o.setParts && !(st.opts.parts && st.opts.parts.length)) miss.push(t('at least one piece from the set'));
  if (o.ringSizes && !st.opts.ringSize) miss.push(t('ring size'));
  if (o.bagSizes && !st.opts.bagSize) miss.push(t('bag size'));
  if (miss.length) { st.err = t('Please choose: {list}.', { list: miss.join(isAr() ? '، ' : ', ') }); render(); return false; }
  const inCart = S.cart.filter(l => l.id === p.id).reduce((a, l) => a + l.qty, 0);
  if (inCart + st.qty > p.stock) { st.err = p.stock - inCart > 0 ? t('Only {n} more available.', { n: p.stock - inCart }) : t('You already have all available pieces in your cart.'); render(); return false; }
  const opts = { ...st.opts }; if (opts.parts) opts.parts = o.setParts.map(x => x.name).filter(n => opts.parts.includes(n));
  addToCart(p.id, opts, st.qty); st.err = ''; return true;
}

const FORMS = {
  promo: async () => {
    const code = (S.ui.promoInput || '').trim().toUpperCase();
    if (!code) { S.ui.promoMsg = { err: 1, text: t('Enter a discount code.') }; return render(); }
    try {
      const pct = await API.checkPromo(code);
      if (pct) { S.promo = { code, rate: pct / 100 }; S.ui.promoMsg = { text: t('Code {code} applied — {pct}% off.', { code, pct }) }; save('promo'); }
      else S.ui.promoMsg = { err: 1, text: t('This code is not valid.') };
    } catch (e) { S.ui.promoMsg = { err: 1, text: API.errMessage(e) }; }
    render();
  },
  feedback: async () => {
    const fb = S.ui.fb;
    if (!S.user) { location.hash = '#/account'; return; }
    if (!fb.rating) { fb.msg = t('Please choose a rating.'); return render(); }
    if (!fb.text.trim()) { fb.msg = t('Please write a few words.'); return render(); }
    fb.busy = true; fb.msg = ''; render();
    try {
      await API.submitReview(fb.rating, fb.text.trim());
      S.ui.fb = { rating: 0, text: '', msg: '', ok: t('Thank you! Your review will appear once it has been approved.'), busy: false };
    } catch (e) { fb.busy = false; fb.msg = API.errMessage(e); }
    render();
  },
  auth: async () => {
    const a = S.ui.auth, f = a.form;
    const pw = ($('#au-password') || {}).value || '';
    a.msg = ''; a.ok = '';
    if (!/^\S+@\S+\.\S+$/.test(f.email || '')) { a.msg = t('Please enter a valid email.'); return render(); }
    if (a.mode === 'signup') {
      if (!(f.name || '').trim()) { a.msg = t('Please enter your name.'); return render(); }
      if (!PHONE_RE.test((f.phone || '').replace(/\s/g, ''))) { a.msg = t('Please enter a valid Egyptian mobile number (01xxxxxxxxx).'); return render(); }
      if (pw.length < 6) { a.msg = t('Your password needs at least 6 characters.'); return render(); }
    }
    if (a.mode === 'signin' && !pw) { a.msg = t('Please enter your password.'); return render(); }
    a.busy = true; render();
    try {
      if (a.mode === 'signin') { await API.auth.signIn(f.email.trim(), pw); toast(t('Welcome back')); }
      else if (a.mode === 'signup') {
        const r = await API.auth.signUp({ email: f.email.trim(), password: pw, name: f.name.trim(), phone: f.phone.replace(/\s/g, '') });
        if (!r.session) a.ok = t('Almost there — we sent a confirmation link to {email}. Open it to activate your account.', { email: f.email.trim() });
        else toast(t('Welcome to ALLURE'));
      } else { await API.auth.resetPassword(f.email.trim()); a.ok = t('If an account exists for this email, a reset link is on its way.'); }
    } catch (e) { a.msg = API.errMessage(e); }
    a.busy = false; render();
  },
  reset: async () => {
    const r = S.ui.reset;
    if ((r.pw || '').length < 6) { r.msg = t('Your password needs at least 6 characters.'); return render(); }
    try { await API.auth.updatePassword(r.pw); S.ui.reset = { pw: '', msg: '', ok: '' }; toast(t('Password updated')); location.hash = '#/account'; }
    catch (e) { r.msg = API.errMessage(e); render(); }
  },
  profile: async () => {
    const p = S.ui.profile;
    if (!(p.name || '').trim()) { S.ui.profileMsg = t('Please enter your name.'); return render(); }
    if (p.phone && !PHONE_RE.test(p.phone.replace(/\s/g, ''))) { S.ui.profileMsg = t('Please enter a valid mobile number.'); return render(); }
    try { S.user = { ...S.user, ...(await API.updateProfile(S.user.id, { name: p.name.trim(), phone: (p.phone || '').replace(/\s/g, '') })) }; S.ui.profileMsg = t('Profile saved.'); }
    catch (e) { S.ui.profileMsg = API.errMessage(e); }
    render();
  },
  track: async () => {
    const tr = S.ui.track;
    if (!tr.no.trim() || !tr.phone.trim()) { tr.msg = t('Please enter both your order number and phone.'); return render(); }
    tr.busy = true; tr.msg = ''; tr.result = null; render();
    try { tr.result = await API.trackOrder(tr.no.trim(), tr.phone.trim()); if (!tr.result) tr.msg = t('We could not find an order with these details. Please check the number and phone.'); }
    catch (e) { tr.msg = API.errMessage(e); }
    tr.busy = false; render();
  },
};

document.addEventListener('click', e => {
  if (e.target.closest('a[href^="http"]')) return;   // external links inside clickable rows
  const el = e.target.closest('[data-act]');
  if (!el) { if (S.ui.sortOpen && !e.target.closest('.sort-wrap')) { S.ui.sortOpen = false; render(); } return; }
  if (el.disabled) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el); }
});
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form]'); if (!f) return;
  e.preventDefault(); FORMS[f.dataset.form] && FORMS[f.dataset.form]();
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'q') {
    S.ui.q = el.value;
    const h = '#/search/' + encodeURIComponent(el.value);
    if (location.hash.startsWith('#/search/')) history.replaceState(null, '', h); else history.pushState(null, '', h);
    render();
    return;
  }
  if (el.dataset.bind) {
    setPath(S.ui, el.dataset.bind, el.value);
    if (el.dataset.rerender) render();
  }
  if (el.dataset.draft) {
    S.ui.draft[el.dataset.draft] = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'checkbox') renderFilters(); else { const h = $('#filters .drawer-head .muted'); if (h) h.textContent = t('{a} of {b} products', { a: applyFilter(S.ui.listCtx.items, S.ui.draft).length, b: S.ui.listCtx.items.length }); }
  }
  if (el.dataset.draftcat) {
    const c = el.dataset.draftcat, d = S.ui.draft;
    d.cats = el.checked ? [...d.cats, c] : d.cats.filter(x => x !== c); renderFilters();
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrawers(); if (S.ui.search) ACTIONS.search(); } });
window.addEventListener('hashchange', () => {
  closeDrawers();
  if (S.ui.search && !location.hash.startsWith('#/search/')) { S.ui.search = false; S.ui.q = ''; renderHeader(); }
  render();
});

// ───────────────────────── boot ─────────────────────────
async function boot() {
  document.documentElement.setAttribute('data-theme', S.theme);
  setTitle(); renderHeader(); renderFooter(); render();
  if (!API.ready) return;
  // links from Supabase emails (confirm sign-up / reset password) land here with tokens in the hash
  let linkType = /access_token=/.test(location.hash) ? ((location.hash.match(/type=([a-z_]+)/) || [])[1] || 'signup') : null;
  const linkError = (location.hash.match(/error_description=([^&]+)/) || [])[1];
  API.auth.onChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' || (linkType === 'recovery' && event === 'SIGNED_IN')) { linkType = null; location.hash = '#/reset'; }
    else if (event === 'SIGNED_IN' && linkType) { linkType = null; location.hash = '#/account'; }
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION') setTimeout(() => onSession(session), 0);
  });
  setTimeout(() => { if (trackOn === null) setTracking(true); }, 5000);   // never wait forever for the session check
  try {
    applyCatalog(await API.catalog());
    if (S.promo) API.checkPromo(S.promo.code).then(p => { if (!p) { S.promo = null; save('promo'); render(); } }).catch(() => {});
  } catch (e) { S.loadError = API.errMessage(e); }
  S.loading = false;
  if (linkError) { S.ui.auth.msg = decodeURIComponent(linkError.replace(/\+/g, ' ')); location.hash = '#/account'; }
  renderFooter(); renderMenu(); render();
}
boot();
})();
