/* ALLURE Boutique — owner dashboard (English / Arabic).
   Same Supabase login as the shop; only accounts with role 'admin' get in (enforced by the database too). */
(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const t = I18N.t, isAr = () => I18N.isAr();
I18N.init('au.admin.lang', 'en');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => Math.round(n || 0).toLocaleString('en-US');
const cur = () => I18N.currency();
const money = n => num(n) + ' ' + cur();
const compact = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : num(n);
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const fmtDT = d => new Date(d).toLocaleString(I18N.locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtD = d => new Date(d).toLocaleDateString(I18N.locale(), { day: 'numeric', month: 'short' });
const dayKey = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const arrow = () => (isAr() ? '←' : '→');
const n1 = (n, one, many) => t(n === 1 ? one : many, { n });
const store = {
  get(k, d) { try { const v = localStorage.getItem('au.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('au.' + k, JSON.stringify(v)); } catch (e) {} },
};

const A = {
  phase: 'loading',          // loading | setup | login | denied | app
  theme: store.get('theme', 'light'),
  profile: null,
  orders: [], products: [], reviews: [], settings: {}, promos: [],
  seen: store.get('admin.seen', null),      // ISO time the owner last looked at the orders list
  ui: {
    side: false, range: 30, chartTable: false,
    otab: 'pending', oq: '', open: null, cancelConfirm: false,
    pq: '', pcat: '', edit: null, editMsg: '', saving: false,
    rtab: 'pending', delConfirm: null,
    sMsg: '', sOk: false, newPromo: { code: '', percent: 10, expires: '' },
    login: { email: '', msg: '', busy: false },
    tg: null, tgMsg: '', bannerUp: false,
    insDays: 30, insErr: '', insLoading: false,
  },
  ins: null, insFor: 0,
  live: { online: 0, carts: 0, pieces: 0, checkout: 0, devices: {}, pages: {}, visitors: [] },
  prefs: store.get('admin.prefs', { sound: true }),
};

const STATUS = ['pending', 'shipped', 'received', 'exchanged', 'refunded', 'cancelled'];
const STATUS_LBL = { cart: 'My Cart', pending: 'Pending', shipped: 'Shipped', received: 'Received', cancelled: 'Cancelled', refunded: 'Returned / refunded', exchanged: 'Exchanged' };
const net = o => o.total - (o.refunded || 0);   // what the shop actually keeps
const PAY = { cod: 'Cash on delivery', instapay: 'InstaPay / VC' };
const PAY_ST = { awaiting: 'Awaiting payment', confirmed: 'Paid', not_required: 'Pay at pickup' };
const prodName = (id, fallback) => { const p = A.products.find(x => x.id === id); return p ? I18N.pick(p.name, p.nameAr) : fallback; };
const optText = (o = {}) => [o.color && I18N.opt(o.color), o.letter && t('Letter {v}', { v: o.letter }), o.ringSize && t('Size {v}', { v: o.ringSize }), o.bagSize,
  o.parts && o.parts.length && o.parts.map(I18N.opt).join(' + ')].filter(Boolean).join(' · ');
const catLabel = name => { const c = (A.settings.categories || []).find(x => x.name === name); return c ? I18N.pick(c.name, c.ar) : name; };
const subLabel = (cat, sub) => { const c = (A.settings.categories || []).find(x => x.name === cat); return I18N.pick(sub, c && c.subs_ar && c.subs_ar[sub]); };
const cityLabel = city => { const d = (A.settings.delivery || []).find(x => x.city === city); return d ? I18N.pick(d.city, d.ar) : city; };

const DEVICE_NAME = () => (/iPhone|Android.+Mobile/i.test(navigator.userAgent) ? 'phone' : /iPad|Android/i.test(navigator.userAgent) ? 'tablet' : 'computer');
let toastT;
function toast(msg) { const el = $('#toast'); el.innerHTML = `<span>${esc(msg)}</span>`; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3200); }

// ───────────────────────── who can do what ─────────────────────────
// The main owner can do everything; staff only what the owner ticked on the Team page.
// (The database enforces the same rules — this only hides what someone can't use.)
// (an 'admin' without a perms field means the database hasn't been updated yet — treat it as the owner until schema.sql runs)
const isOwnerAcc = () => !!(A.profile && (A.profile.role === 'owner' || (A.profile.role === 'admin' && A.profile.perms === undefined)));
const can = p => isOwnerAcc() || !!(A.profile && A.profile.role === 'admin' && !A.profile.suspended && (A.profile.perms || []).includes(p));
const PERM_GROUPS = [
  ['Orders', [['orders.view', 'See orders'], ['orders.manage', 'Change status, payment and notes'], ['orders.edit', 'Edit orders and exchanges'], ['orders.refund', 'Returns and refunds'], ['orders.delete', 'Delete orders']]],
  ['Customers', [['customers.view', 'See customers and their details'], ['customers.edit', 'Edit customers and their addresses'], ['customers.block', 'Block and unblock']]],
  ['Shop', [['products.edit', 'Add and edit products'], ['categories.edit', 'Edit categories'], ['reviews.manage', 'Approve and delete reviews'], ['pages.edit', 'Edit policy pages'], ['promos.edit', 'Discount codes']]],
  ['Business', [['settings.edit', 'Store settings (banner, delivery fees, payment, contact, emails)'], ['insights.view', 'Sales overview and visitor insights'], ['export.data', 'Export to Excel'], ['activity.view', 'See everyone’s activity']]],
];

// ───────────────────────── loading ─────────────────────────
async function loadAll() {
  const none = () => Promise.resolve([]);
  const [orders, products, reviews, settings, promos] = await Promise.all([
    can('orders.view') ? API.admin.orders() : none(), API.admin.products(),
    can('reviews.manage') ? API.admin.reviews() : none(), API.admin.settings(),
    can('promos.edit') ? API.admin.promos() : none(),
  ]);
  Object.assign(A, { orders, products, reviews, settings, promos });
  await loadCustomers();
}
async function loadCustomers() {
  if (!can('customers.view')) { A.customers = null; return; }
  try { A.customers = await API.admin.customers(); } catch (e) { A.customers = null; A.ui.custErr = API.errMessage(e); }
}
const unseen = () => A.orders.filter(o => !A.seen || o.created_at > A.seen).length;
const pendingReviews = () => A.reviews.filter(r => !r.approved).length;
function markSeen() { A.seen = new Date().toISOString(); store.set('admin.seen', A.seen); updateTitle(); }
function updateTitle() { const n = unseen(); document.title = (n ? n1(n, '({n}) New order — ', '({n}) New orders — ') : '') + t('Dashboard — ALLURE Boutique'); }

// ───────────────────────── new-order alerts ─────────────────────────
let audioCtx;
function chime() {
  if (!A.prefs.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [[880, 0], [1320, 0.16]].forEach(([f, at]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
      const s = audioCtx.currentTime + at;
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.25, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.5);
      o.start(s); o.stop(s + 0.55);
    });
  } catch (e) {}
}
function desktopAlert(o) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const pieces = (o.items || []).reduce((a, i) => a + i.qty, 0);
    const n = new Notification(t('New order {no} — {total}', { no: o.order_no, total: money(o.total) }), {
      body: `${o.customer.name} · ${t(PAY[o.payment])} · ${n1(pieces, '{n} item', '{n} items')}`,
      icon: 'assets/logo-mark.png', tag: o.order_no,
    });
    n.onclick = () => { window.focus(); openOrder(o.order_no); n.close(); };
  } catch (e) {}
}
function onOrderChange(payload) {
  const row = payload.new;
  if (payload.eventType === 'INSERT') {
    if (A.orders.some(o => o.id === row.id)) return;
    A.orders.unshift(row);
    chime(); desktopAlert(row); toast(t('New order {no} — {total}', { no: row.order_no, total: money(row.total) }));
  } else if (payload.eventType === 'UPDATE') {
    const i = A.orders.findIndex(o => o.id === row.id); if (i >= 0) A.orders[i] = row;
  }
  if (payload.new && payload.new.order_no) delete (A.ui.eact || {})['orders:' + payload.new.order_no];
  updateTitle(); if (!$('input:focus, textarea:focus, select:focus')) render();
}

// ───────────────────────── shell ─────────────────────────
const NAV = [['overview', 'OVERVIEW', () => can('insights.view')], ['insights', 'INSIGHTS', () => can('insights.view')], ['orders', 'ORDERS', () => can('orders.view')],
  ['customers', 'CUSTOMERS', () => can('customers.view')], ['products', 'PRODUCTS', () => can('products.edit')], ['categories', 'CATEGORIES', () => can('categories.edit')],
  ['reviews', 'REVIEWS', () => can('reviews.manage')], ['pages', 'PAGES', () => can('pages.edit')], ['settings', 'SETTINGS', () => can('settings.edit') || can('promos.edit')],
  ['notifications', 'NOTIFICATIONS', () => true], ['export', 'EXPORT', () => can('export.data')], ['activity', 'ACTIVITY', () => can('activity.view')], ['team', 'TEAM', isOwnerAcc]];
const navAllowed = k => { const n = NAV.find(x => x[0] === k); return !n || n[2](); };
const homePage = () => (NAV.find(n => n[2]()) || ['me'])[0];
const langBtn = () => `<button data-act="lang" lang="${isAr() ? 'en' : 'ar'}">${isAr() ? 'ENGLISH' : 'عربي'}</button>`;
function shell(page, body) {
  const counts = { orders: unseen(), reviews: pendingReviews(), insights: A.live.online };
  return `<div class="adm">
    <aside class="adm-side${A.ui.side ? ' open' : ''}">
      <div class="brand"><img class="logo-light" src="assets/logo-light.png" alt="ALLURE Boutique"><img class="logo-dark" src="assets/logo-dark.png" alt="ALLURE Boutique"><span>${isOwnerAcc() ? t('OWNER DASHBOARD') : t('STAFF DASHBOARD')}</span></div>
      <nav class="adm-nav">${NAV.filter(n => n[2]()).map(([k, l]) => `<button class="${page === k ? 'on' : ''}" data-act="go" data-href="#/${k}">${t(l)}${counts[k] ? `<span class="cnt${k === 'insights' ? ' live' : ''}">${k === 'insights' ? '● ' : ''}${counts[k]}</span>` : ''}</button>`).join('')}</nav>
      <div class="foot">
        <a href="index.html?preview=1" target="_blank" rel="noopener">${t('VIEW SHOP')} ↗</a>
        ${langBtn()}
        <button data-act="theme">${A.theme === 'dark' ? '☀ ' + t('IVORY MODE') : '☾ ' + t('NOIR MODE')}</button>
        <button data-act="go" data-href="#/me">${t('MY ACCOUNT')} · ${esc((A.profile.name || A.profile.email).split(' ')[0])}${isOwnerAcc() ? '' : ` <span class="muted">(${t('staff')})</span>`}</button>
        <button data-act="signOut">${t('SIGN OUT')}</button>
      </div>
    </aside>
    <div style="min-width:0">
      <div class="adm-top"><button class="icon-btn" data-act="side" aria-label="${t('Menu')}">☰</button>
        <img class="logo-light" src="assets/logo-light.png" alt="ALLURE"><img class="logo-dark" src="assets/logo-dark.png" alt="ALLURE">
        ${can('orders.view') ? `<button class="icon-btn" data-act="go" data-href="#/orders" aria-label="${t('Orders')}" style="font-size:12px">${counts.orders ? `<span class="pill2 awaiting">${t('{n} NEW', { n: counts.orders })}</span>` : t('ORDERS')}</button>` : '<span></span>'}</div>
      <main class="adm-main">${body}</main>
    </div>
  </div>`;
}
const head = (title, sub, right = '') => `<div class="adm-h"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${right}</div>`;
const statusPill = s => `<span class="status ${s}">${t(STATUS_LBL[s] || s)}</span>`;
const payPill = s => `<span class="pill2 ${s}">${t(PAY_ST[s] || s)}</span>`;
const daysSeg = (act, cur) => `<div class="seg">${[7, 30, 90].map(d => `<button class="${cur === d ? 'on' : ''}" data-act="${act}" data-d="${d}">${t('{n} DAYS', { n: d })}</button>`).join('')}</div>`;

// ───────────────────────── overview ─────────────────────────
function rangeOrders(days) {
  const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - (days - 1));
  return { from, list: A.orders.filter(o => new Date(o.created_at) >= from) };
}
function viewOverview() {
  const days = A.ui.range;
  const { from, list } = rangeOrders(days);
  const live = list.filter(o => o.status !== 'cancelled');
  const revenue = live.reduce((a, o) => a + net(o), 0);
  const today = dayKey(new Date());
  const todayRev = A.orders.filter(o => o.status !== 'cancelled' && dayKey(o.created_at) === today).reduce((a, o) => a + net(o), 0);
  const awaiting = A.orders.filter(o => o.payment_status === 'awaiting' && o.status !== 'cancelled').length;
  const toShip = A.orders.filter(o => o.status === 'pending').length;

  // previous period, for the delta
  const prevFrom = new Date(from); prevFrom.setDate(prevFrom.getDate() - days);
  const prevRev = A.orders.filter(o => o.status !== 'cancelled' && new Date(o.created_at) >= prevFrom && new Date(o.created_at) < from).reduce((a, o) => a + net(o), 0);
  const delta = prevRev ? Math.round((revenue - prevRev) / prevRev * 100) : null;

  // top products by pieces sold
  const sold = {};
  live.forEach(o => (o.items || []).forEach(i => { const k = i.id || i.name; sold[k] = sold[k] || { name: prodName(i.id, i.name), q: 0, r: 0 }; sold[k].q += i.qty; sold[k].r += i.qty * i.unit; }));
  const top = Object.values(sold).sort((a, b) => b.q - a.q).slice(0, 5);
  const maxQ = top.length ? top[0].q : 1;
  const byStatus = STATUS.map(s => [s, A.orders.filter(o => o.status === s).length]);
  const lv = A.live;

  return head(t('Overview'), t('Since {date} · cancelled orders excluded', { date: fmtD(from) }), daysSeg('range', days)) + `
    <button class="live-strip" data-act="go" data-href="#/insights"><span class="dot"></span>${t('{a} online now · {b} with items in cart · {c} at checkout', { a: `<b>${lv.online}</b>`, b: `<b>${lv.carts}</b>`, c: `<b>${lv.checkout}</b>` })} <span class="muted">— ${t('see Insights')} ${arrow()}</span></button>
    <div class="tiles">
      <div class="tile big"><div class="lbl">${t('Revenue, last {n} days', { n: days })}</div><div class="val">${compact(revenue)}<small>${cur()}</small></div>
        <div class="delta">${delta == null ? t('No earlier period to compare') : `${delta >= 0 ? '▲' : '▼'} ${t('{p}% vs previous {n} days', { p: Math.abs(delta), n: days })}`}</div></div>
      <div class="tile"><div class="lbl">${t('Orders')}</div><div class="val">${num(live.length)}</div><div class="delta">${t('{amount} today', { amount: money(todayRev) })}</div></div>
      <div class="tile"><div class="lbl">${t('Average order')}</div><div class="val">${live.length ? compact(revenue / live.length) : '—'}<small>${live.length ? cur() : ''}</small></div></div>
      <div class="tile link" data-act="go" data-href="#/orders/awaiting"><div class="lbl">${t('Awaiting InstaPay')}</div><div class="val">${awaiting}</div><div class="delta">${t('Confirm transfers')} ${arrow()}</div></div>
      <div class="tile link" data-act="go" data-href="#/orders/pending"><div class="lbl">${t('To ship')}</div><div class="val">${toShip}</div><div class="delta">${t('Pending orders')} ${arrow()}</div></div>
    </div>
    <div class="adm-grid g-main mt">
      <div class="adm-card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px"><div><h3>${t('REVENUE BY DAY')}</h3><p class="note">${t('{cur} per day, last {n} days', { cur: cur(), n: days })}</p></div>
          <button class="tbl-toggle" data-act="chartTable">${A.ui.chartTable ? t('Show chart') : t('Show as table')}</button></div>
        <div class="chart-wrap" id="revChart"></div>
      </div>
      <div class="adm-grid">
        <div class="adm-card"><h3>${t('ORDERS BY STATUS')}</h3><p class="note">${t('All time')}</p>
          <div class="stat-list">${byStatus.map(([s, n]) => `<button data-act="go" data-href="#/orders/${s}">${statusPill(s)}<b>${n}</b></button>`).join('')}</div></div>
        <div class="adm-card"><h3>${t('TOP PIECES')}</h3><p class="note">${t('By pieces sold, last {n} days', { n: days })}</p>
          ${top.length ? `<ul class="rank">${top.map(v => `<li><span>${esc(v.name)}</span><span class="v">${v.q} · ${compact(v.r)} ${cur()}</span><span class="meter"><i style="width:${Math.max(4, v.q / maxQ * 100)}%"></i></span></li>`).join('')}</ul>` : `<div class="chart-empty">${t('No sales yet in this period.')}</div>`}
        </div>
      </div>
    </div>
    <div class="adm-card mt"><h3>${t('LATEST ORDERS')}</h3><p class="note">${t('Click an order to manage it')}</p>${ordersTable(A.orders.slice(0, 6))}</div>`;
}
function dailySeries(days) {
  const { from } = rangeOrders(days);
  const out = [];
  for (let i = 0; i < days; i++) { const d = new Date(from); d.setDate(d.getDate() + i); out.push({ key: dayKey(d), date: d, rev: 0, n: 0 }); }
  const idx = Object.fromEntries(out.map((x, i) => [x.key, i]));
  A.orders.forEach(o => { if (o.status === 'cancelled') return; const i = idx[dayKey(o.created_at)]; if (i != null) { out[i].rev += net(o); out[i].n++; } });
  return out;
}
function niceMax(v) { if (v <= 0) return 1000; const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }
function drawChart() {
  const el = $('#revChart'); if (!el) return;
  const data = dailySeries(A.ui.range);
  if (A.ui.chartTable) {
    el.innerHTML = `<div class="atbl-wrap" style="max-height:320px;overflow:auto"><table class="atbl"><thead><tr><th>${t('DATE')}</th><th class="num">${t('ORDERS')}</th><th class="num">${t('REVENUE')}</th></tr></thead><tbody>${data.slice().reverse().map(d => `<tr style="cursor:default"><td>${fmtD(d.date)}</td><td class="num">${d.n}</td><td class="num">${money(d.rev)}</td></tr>`).join('')}</tbody></table></div>`;
    return;
  }
  if (!data.some(d => d.rev)) { el.innerHTML = `<div class="chart-empty">${t('No orders in this period yet — revenue will appear here.')}</div>`; return; }
  drawBars(el, data.map(d => ({ date: d.date, v: d.rev, n: d.n })), money, d => `${fmtD(d.date)} · ${n1(d.n, '{n} order', '{n} orders')}`, t('Revenue by day'));
}
// single-series daily columns with hover/focus tooltip (shared by Overview and Insights); time always runs left → right
function drawBars(el, data, valFmt, subFmt, label) {
  const W = el.clientWidth || 600, H = 260, L = 52, R = 8, T = 12, B = 28;
  const pw = W - L - R, ph = H - T - B;
  let max = niceMax(Math.max(...data.map(d => d.v)));
  if (max < 4 && data.every(d => Number.isInteger(d.v))) max = 4;   // small counts: whole-number steps 0–4
  const slot = pw / data.length, bw = Math.max(2, Math.min(24, slot - 2));
  const y = v => T + ph - (v / max) * ph;
  const ticks = [0, .25, .5, .75, 1].map(f => max * f);
  const every = Math.ceil(data.length / (W < 500 ? 5 : 8));
  const bar = (x, top, w, h) => { const r = Math.min(4, w / 2, h); return `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${top + h}Z`; };
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">
    <g class="grid">${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>
    <g class="axis">${ticks.map(v => `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`).join('')}
      ${data.map((d, i) => (i % every === 0 && (data.length - 1 - i >= every / 2 || i === data.length - 1)) || (i === data.length - 1) ? `<text x="${L + slot * i + slot / 2}" y="${H - 8}" text-anchor="middle">${d.axis ? esc(d.axis) : fmtD(d.date)}</text>` : '').join('')}</g>
    <g>${data.map((d, i) => { const x = L + slot * i + (slot - bw) / 2, h = (d.v / max) * ph; return d.v ? `<path class="bar" d="${bar(x, y(d.v), bw, h)}"/>` : ''; }).join('')}</g>
    <g>${data.map((d, i) => `<rect class="hit" x="${L + slot * i}" y="${T}" width="${slot}" height="${ph}" tabindex="0" data-i="${i}" aria-label="${esc(subFmt(d))}: ${esc(valFmt(d.v))}"/><rect class="hl" x="${L + slot * i + slot / 2 - 0.5}" y="${T}" width="1" height="${ph}"/>`).join('')}</g>
  </svg><div class="chart-tip" hidden></div>`;
  const tip = el.querySelector('.chart-tip');
  const show = r => {
    const d = data[+r.dataset.i]; tip.hidden = false;
    tip.innerHTML = ''; const b = document.createElement('b'); b.textContent = valFmt(d.v); const s = document.createElement('span'); s.textContent = subFmt(d);
    tip.append(b, s);
    const x = +r.getAttribute('x') + slot / 2; tip.style.left = Math.min(Math.max(x, 70), W - 70) + 'px'; tip.style.top = (d.v ? y(d.v) : T + ph) + 'px';
  };
  el.querySelectorAll('.hit').forEach(r => { r.addEventListener('pointerenter', () => show(r)); r.addEventListener('focus', () => show(r)); });
  el.querySelector('svg').addEventListener('pointerleave', () => { tip.hidden = true; });
}

// ───────────────────────── orders ─────────────────────────
function ordersTable(list) {
  if (!list.length) return `<div class="chart-empty">${t('No orders here yet.')}</div>`;
  return `<div class="atbl-wrap"><table class="atbl"><thead><tr><th>${t('ORDER')}</th><th>${t('CUSTOMER')}</th><th class="hide-m">${t('ITEMS')}</th><th class="num">${t('TOTAL')}</th><th class="hide-m">${t('PAYMENT')}</th><th>${t('STATUS')}</th></tr></thead><tbody>
    ${list.map(o => `<tr class="${!A.seen || o.created_at > A.seen ? 'new' : ''}" data-act="openOrder" data-no="${esc(o.order_no)}">
      <td><a class="no" href="#/order/${esc(encodeURIComponent(o.order_no))}">${esc(o.order_no)}</a><div class="sm">${fmtDT(o.created_at)}</div></td>
      <td><span dir="auto">${esc(o.customer.name)}</span><div class="sm">${esc(o.customer.phone)} · ${o.fulfil === 'pickup' ? t('Pickup') : esc(cityLabel(o.city || ''))}</div></td>
      <td class="hide-m">${(o.items || []).reduce((a, i) => a + i.qty, 0)}</td>
      <td class="num">${money(o.total)}${o.refunded ? `<div class="sm bad">−${money(o.refunded)}</div>` : ''}</td>
      <td class="hide-m">${t(PAY[o.payment])}<div style="margin-top:4px">${payPill(o.payment_status)}</div></td>
      <td>${statusPill(o.status)}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function viewOrders(tab) {
  if (tab) A.ui.otab = tab;
  const cur = A.ui.otab, q = A.ui.oq.trim().toLowerCase();
  const tabs = [['pending', 'New / Pending'], ['awaiting', 'Awaiting payment'], ['shipped', 'Shipped'], ['received', 'Received'], ['exchanged', 'Exchanged'], ['refunded', 'Returned / refunded'], ['cancelled', 'Cancelled'], ['all', 'All']];
  const match = (o, k) => k === 'all' ? true : k === 'awaiting' ? o.payment_status === 'awaiting' && o.status !== 'cancelled' : o.status === k;
  let list = A.orders.filter(o => match(o, cur));
  if (q) list = list.filter(o => [o.order_no, o.customer.name, o.customer.phone, o.customer.email].join(' ').toLowerCase().includes(q));
  return head(t('Orders'), t('{n} orders in total · new orders appear here instantly', { n: A.orders.length })) + `
    <div class="tabs2">${tabs.map(([k, l]) => `<button class="${cur === k ? 'on' : ''}" data-act="go" data-href="#/orders/${k}">${t(l)}<i>${A.orders.filter(o => match(o, k)).length}</i></button>`).join('')}</div>
    <div class="atools"><input class="field" id="oq" type="search" placeholder="${t('Search order no, name or phone')}" value="${esc(A.ui.oq)}"></div>
    ${ordersTable(list)}`;
}
function openOrder(no) { location.hash = '#/order/' + encodeURIComponent(no); }
function closeAll() {
  A.ui.side = false; A.ui.cancelConfirm = false;
  $('#drawer').classList.remove('open'); $('#scrim').classList.remove('open');
  const s = $('.adm-side'); if (s) s.classList.remove('open');
}
const custKey = o => o.user_id ? 'u:' + o.user_id : 'p:' + o.customer.phone;
const backLink = (href, label) => `<button class="back-link" data-act="go" data-href="${esc(href)}">${isAr() ? '→' : '←'} ${label}</button>`;
// activity rows for one thing (an order, a customer…), loaded when its page opens
function entityActivity(entity, id) {
  const key = entity + ':' + id, c = A.ui.eact || (A.ui.eact = {});
  if (!c[key]) {
    c[key] = { loading: true, rows: [] };
    API.admin.activity({ entity, id, limit: 100 }).then(rows => { c[key] = { rows }; render(); }, () => { c[key] = { rows: [], err: true }; });
  }
  return c[key];
}
function activityCard(entity, id, title) {
  const a = entityActivity(entity, id);
  return `<div class="adm-card"><h3>${title || t('ACTIVITY')}</h3>
    ${a.loading ? `<p class="note">${t('Loading…')}</p>` : a.rows.length ? `<div class="act-list compact">${a.rows.map(r => actRow(r, true)).join('')}</div>` : `<p class="note">${t('No changes by the team yet.')}</p>`}</div>`;
}
function viewOrder(no) {
  const o = A.orders.find(x => x.order_no === no);
  A.ui.open = no;
  if (!o) return backLink('#/orders', t('Orders')) + head(esc(no)) + `<div class="adm-card"><p class="note" style="margin:0">${t('This order doesn’t exist any more, or you can’t see it.')}</p></div>`;
  const c = o.customer, h = o.history || {};
  const first = (c.name || '').split(' ')[0];
  const wa = (phone, text) => `https://wa.me/2${phone}?text=${encodeURIComponent(text)}`;
  const msgs = {
    pending: t('Hello {name}, thank you for your order {no} from ALLURE Boutique ({total}).', { name: first, no: o.order_no, total: money(o.total) }),
    shipped: t('Hello {name}, your ALLURE order {no} is on its way! ✨', { name: first, no: o.order_no }),
    received: t('Hello {name}, we hope you love your ALLURE pieces! Order {no}.', { name: first, no: o.order_no }),
    cancelled: t('Hello {name}, about your ALLURE order {no}:', { name: first, no: o.order_no }),
  };
  const toReceive = o.payment === 'instapay' ? t('{amount} (full order)', { amount: money(o.total) })
    : t('{fee} delivery fee first, {rest} cash on delivery', { fee: money(o.delivery_fee), rest: money(o.total - o.delivery_fee) });
  const manage = can('orders.manage');
  // any status can be chosen again (e.g. received → shipped by mistake); stock follows automatically
  const moves = ['pending', 'shipped', 'received', 'exchanged', 'cancelled'].filter(st => st !== o.status);
  const back = A.ui.backTo && A.ui.backTo.no === no ? A.ui.backTo : { href: '#/orders', label: t('Orders') };
  const custLink = can('customers.view') ? `<button class="link-btn" data-act="go" data-href="#/customer/${esc(encodeURIComponent(custKey(o)))}">${t('OPEN CUSTOMER')} ${arrow()}</button>` : '';
  const left = `
      <div class="adm-card"><h3>${t('ITEMS')}</h3>
        ${(o.items || []).map(i => `<div class="mini"><div class="th" style="${i.image ? `background:url('${esc(i.image)}') center/cover` : 'background:' + i.bg}"></div>
          <div><div class="nm">${esc(prodName(i.id, i.name))}</div><div class="d">#${esc(i.code)}${optText(i.opts) ? ' · ' + esc(optText(i.opts)) : ''}</div></div>
          <div class="pr">${i.qty} × ${money(i.unit)}</div></div>`).join('')}
        <div class="summary" style="border:none;padding:12px 0 0;margin:0;background:none">
          <div class="row"><span>${t('Subtotal')}</span><b>${money(o.subtotal)}</b></div>
          ${o.discount ? `<div class="row"><span>${t('Discount')}${o.promo_code ? ` (${esc(o.promo_code)})` : ''}</span><b>−${money(o.discount)}</b></div>` : ''}
          <div class="row"><span>${t('Delivery')}</span><b>${o.delivery_fee ? money(o.delivery_fee) : t('Free')}</b></div>
          <div class="row total"><span>${t('Total')}</span><b>${money(o.total)}</b></div>
          ${o.refunded ? `<div class="row"><span class="bad">${t('Refunded')}</span><b class="bad">−${money(o.refunded)}</b></div>` : ''}</div>
      </div>
      ${can('orders.edit') || can('orders.refund') || can('orders.delete') ? manageCard(o) : ''}
      ${(o.changes || []).length ? `<div class="adm-card"><h3>${t('CHANGE LOG')}</h3>${o.changes.slice().reverse().map(ch => `<div class="log-row"><b>${t({ edit: 'Edited', exchange: 'Exchanged', refund: 'Refunded', refund_undone: 'Refund cancelled', linked: 'Added to the customer’s account' }[ch.type] || ch.type)}</b> · <span class="muted">${fmtDT(ch.at)}</span>
        ${ch.type === 'refund' ? ` · ${money(ch.amount)}${ch.restock ? ' · ' + t('pieces returned to stock') : ''}` : ch.type === 'refund_undone' ? ` · ${money(ch.amount)}` : ch.total_before != null ? ` · ${money(ch.total_before)} ${arrow()} ${money(ch.total_after)}` : ''}${ch.note ? `<div dir="auto">${esc(ch.note)}</div>` : ''}</div>`).join('')}</div>` : ''}
      ${activityCard('orders', o.order_no, t('WHO DID WHAT'))}`;
  const right = `
      <div class="adm-card"><h3>${t('STATUS')}</h3>
        <div style="margin-top:10px">${statusPill(o.status)}</div>
        ${manage ? `<p class="note" style="margin:14px 0 8px">${t('Move to')}</p>
        <div class="actions">${moves.map(st => st === 'cancelled'
            ? (A.ui.cancelConfirm ? `<button class="btn btn-danger btn-sm" data-act="setStatus" data-s="cancelled">${t('CONFIRM CANCEL — STOCK IS RETURNED')}</button><button class="btn btn-line btn-sm" data-act="cancelNo">${t('KEEP ORDER')}</button>`
              : `<button class="btn btn-danger btn-sm" data-act="cancelAsk">${t('CANCEL ORDER')}</button>`)
            : `<button class="btn ${({ pending: 'shipped', shipped: 'received' }[o.status] === st) ? 'btn-gold' : 'btn-line'} btn-sm" data-act="setStatus" data-s="${st}">${t(STATUS_LBL[st])}</button>`).join('')}</div>
        <p class="hint" style="margin-top:10px">${t('You can always move an order back. Cancelling puts the pieces back in stock; bringing it back takes them out again.')}</p>` : ''}
        <div class="kv" style="margin-top:16px">${['cart', 'pending', 'shipped', 'received', 'exchanged', 'refunded', 'cancelled'].filter(k => h[k]).map(k => `<span class="k">${t(STATUS_LBL[k])}</span><span>${fmtDT(h[k])}</span>`).join('')}</div>
      </div>
      <div class="adm-card"><h3>${t('PAYMENT')}</h3>
        <div class="kv" style="margin-top:12px"><span class="k">${t('METHOD')}</span><span>${t(PAY[o.payment])}</span><span class="k">${t('STATUS')}</span><span>${payPill(o.payment_status)}</span>
          ${o.payment_status !== 'not_required' ? `<span class="k">${t('TO RECEIVE')}</span><span>${toReceive}</span>` : ''}</div>
        ${!manage ? '' : o.payment_status === 'awaiting' ? `<div class="actions" style="margin-top:14px"><button class="btn btn-ink btn-sm" data-act="setPay" data-v="confirmed">${t('MARK PAYMENT RECEIVED')}</button></div>`
          : o.payment_status === 'confirmed' ? `<div class="actions" style="margin-top:14px"><button class="btn btn-line btn-sm" data-act="setPay" data-v="awaiting">${t('UNDO — MARK AS NOT PAID')}</button></div>` : ''}
      </div>
      <div class="adm-card"><h3>${t('CUSTOMER')}</h3>
        <div class="kv" style="margin-top:12px"><span class="k">${t('NAME')}</span><span><span dir="auto">${esc(c.name)}</span> <span class="pill2 off">${o.user_id ? t('ACCOUNT') : t('GUEST')}</span></span>
          <span class="k">${t('PHONE')}</span><span dir="ltr" style="text-align:start">${esc(c.phone)}${c.phone2 ? ' / ' + esc(c.phone2) : ''}</span><span class="k">${t('EMAIL')}</span><span>${esc(c.email)}</span>
          <span class="k">${o.fulfil === 'pickup' ? t('PICKUP') : t('DELIVER TO')}</span><span dir="auto">${esc(o.address)}</span>
          ${o.note ? `<span class="k">${t('NOTE')}</span><span dir="auto">${esc(o.note)}</span>` : ''}</div>
        <div class="actions" style="margin-top:14px">
          <a class="btn btn-gold btn-sm" href="${wa(c.phone, msgs[o.status] || msgs.pending)}" target="_blank" rel="noopener">${t('WHATSAPP')}</a>
          <a class="btn btn-line btn-sm" href="tel:${esc(c.phone)}">${t('CALL')}</a>${custLink}</div>
      </div>
      <div class="adm-card"><h3>${t('INTERNAL NOTE')}</h3><p class="note">${t('Only the team can see this.')}</p>
        <textarea class="field" id="adminNote" style="min-height:80px" dir="auto"${manage ? '' : ' disabled'}>${esc(o.admin_note)}</textarea>
        ${manage ? `<div class="actions" style="margin-top:10px"><button class="btn btn-ink btn-sm" data-act="saveNote">${t('SAVE NOTE')}</button></div>` : ''}</div>`;
  return backLink(back.href, back.label) + `<div class="adm-h"><div><h1 class="ono">${esc(o.order_no)}</h1><div class="sub">${fmtDT(o.created_at)} · <span dir="auto">${esc(c.name)}</span> · ${money(o.total)}</div></div>${statusPill(o.status)}</div>
    <div class="opage"><div class="col">${left}</div><div class="col">${right}</div></div>`;
}
async function patchOrder(patch, okMsg) {
  const o = A.orders.find(x => x.order_no === A.ui.open); if (!o) return;
  try {
    const row = await API.admin.updateOrder(o.id, patch);
    A.orders[A.orders.findIndex(x => x.id === o.id)] = row;
    A.ui.cancelConfirm = false;
    if (patch.status) A.products = await API.admin.products();   // stock may have changed
    delete (A.ui.eact || {})['orders:' + o.order_no];
    toast(okMsg); render();
  } catch (e) { toast(API.errMessage(e)); }
}

// ───────────────────────── products ─────────────────────────
function viewProducts() {
  const q = A.ui.pq.trim().toLowerCase(), c = A.ui.pcat;
  let list = A.products;
  if (c) list = list.filter(p => p.cat === c);
  if (q) list = list.filter(p => [p.name, p.nameAr, p.code, p.sub, p.material].join(' ').toLowerCase().includes(q));
  const cats = (A.settings.categories || []).map(x => x.name);
  const low = A.products.filter(p => p.active && p.stock <= 2).length;
  const flagLbl = { sale: 'SALE', best: 'BEST', new: 'NEW' };
  return head(t('Products'), t('{a} in the shop · {b} hidden', { a: A.products.filter(p => p.active).length, b: A.products.filter(p => !p.active).length }) + (low ? ` · <span class="bad">${t('{n} low on stock', { n: low })}</span>` : ''),
      `<button class="btn btn-gold" data-act="go" data-href="#/products/new">+ ${t('ADD PRODUCT')}</button>`) + `
    <div class="atools"><input class="field" id="pq" type="search" placeholder="${t('Search name or code')}" value="${esc(A.ui.pq)}">
      <select class="field" id="pcat"><option value="">${t('All categories')}</option>${cats.map(n => `<option value="${esc(n)}"${c === n ? ' selected' : ''}>${esc(catLabel(n))}</option>`).join('')}</select></div>
    ${list.length ? `<div class="atbl-wrap"><table class="atbl"><thead><tr><th></th><th>${t('PRODUCT')}</th><th class="hide-m">${t('CATEGORY')}</th><th class="num">${t('PRICE')}</th><th class="num">${t('STOCK')}</th><th class="hide-m">${t('SHOWN AS')}</th><th>${t('SHOP')}</th></tr></thead><tbody>
      ${list.map(p => `<tr data-act="go" data-href="#/products/${esc(p.id)}">
        <td style="width:60px"><span class="pthumb" style="${p.images[0] ? `background-image:url('${esc(p.images[0])}')` : 'background:' + p.bg}"></span></td>
        <td>${esc(I18N.pick(p.name, p.nameAr))}<div class="sm">#${esc(p.code)}${isAr() || !p.nameAr ? '' : ` · <span dir="rtl">${esc(p.nameAr)}</span>`}${!p.nameAr ? ` · <span class="bad">${t('no Arabic')}</span>` : ''}</div></td>
        <td class="hide-m">${esc(catLabel(p.cat))}${p.sub ? `<div class="sm">${esc(subLabel(p.cat, p.sub))}</div>` : ''}</td>
        <td class="num">${money(p.price)}${p.oldPrice ? `<div class="sm"><s>${money(p.oldPrice)}</s></div>` : ''}</td>
        <td class="num ${p.stock === 0 ? 'bad' : ''}">${p.stock}</td>
        <td class="hide-m">${['sale', 'best', 'new'].filter(f => p.flags[f]).map(f => `<span class="pill2 flag">${t(flagLbl[f])}</span>`).join('') || '<span class="sm">—</span>'}</td>
        <td>${p.active ? `<span class="pill2 confirmed">${t('LIVE')}</span>` : `<span class="pill2 off">${t('HIDDEN')}</span>`}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="chart-empty">${t('No products match.')}</div>`}`;
}
function blankProduct() {
  const cat = (A.settings.categories || [])[0] || { name: 'Jewelry', bg: 'linear-gradient(150deg,#e0cd9e,#b18f48)' };
  return { id: '', code: '', name: '', cat: cat.name, sub: '', price: '', oldPrice: '', material: '', size: '', color: '', comesWith: [], desc: '',
    nameAr: '', descAr: '', materialAr: '', sizeAr: '', colorAr: '', comesWithAr: [],
    flags: {}, stock: 1, images: [], bg: cat.bg, options: {}, active: true, _new: true };
}
function viewProductEdit(id) {
  if (!A.ui.edit || A.ui.edit._key !== id) {
    const src = id === 'new' ? blankProduct() : A.products.find(p => p.id === id);
    if (!src) return head(t('Product not found')) + `<button class="btn btn-line" data-act="go" data-href="#/products">${t('BACK TO PRODUCTS')}</button>`;
    const p = JSON.parse(JSON.stringify(src));
    p._key = id; p._new = id === 'new';
    const o = p.options || {};
    p._colors = (o.colors || []).map(c => ({ ar: '', ...c }));
    p._letters = !!o.letters;
    p._ring = (o.ringSizes || []).join(', ');
    p._bag = (o.bagSizes || []).join(', ');
    p._parts = (o.setParts || []).map(x => ({ ar: '', ...x }));
    p._comes = (p.comesWith || []).join('\n');
    p._comesAr = (p.comesWithAr || []).join('\n');
    A.ui.edit = p; A.ui.editMsg = '';
  }
  const p = A.ui.edit;
  const cats = A.settings.categories || [];
  const cat = cats.find(c => c.name === p.cat) || { subs: [] };
  const f = (k, label, type = 'text', extra = '') => `<div><label for="pe-${k}">${label}</label><input id="pe-${k}" class="field" type="${type}" dir="${type === 'number' ? 'ltr' : 'auto'}" data-pe="${k}" value="${esc(p[k] == null ? '' : p[k])}" ${extra}></div>`;
  const fa = (k, label) => `<div><label for="pe-${k}">${label}</label><input id="pe-${k}" class="field" dir="rtl" lang="ar" data-pe="${k}" value="${esc(p[k] || '')}"></div>`;
  return head(p._new ? t('Add product') : esc(I18N.pick(p.name, p.nameAr)), p._new ? t('Fill in the details and save — it appears in the shop immediately.') : `#${esc(p.code)} · ${esc(catLabel(p.cat))}${p.sub ? ' · ' + esc(subLabel(p.cat, p.sub)) : ''}`,
      `<button class="btn btn-line" data-act="go" data-href="#/products">${isAr() ? '→' : '←'} ${t('ALL PRODUCTS')}</button>`) + `
    <form data-form="product">
    <div class="pe">
      <div class="adm-grid">
        <div class="adm-card"><h3>${t('BASICS')}</h3><div class="frm" style="margin-top:14px">
          <div class="full"><label for="pe-name">${t('Name (English)')}</label><input id="pe-name" class="field" dir="ltr" data-pe="name" value="${esc(p.name)}" required></div>
          ${f('code', t('Code (shown as #)'), 'text', 'required dir="ltr"')}
          <div><label for="pe-cat">${t('Category')}</label><select id="pe-cat" class="field" data-pe="cat" data-rerender="1">${cats.map(c => `<option value="${esc(c.name)}"${c.name === p.cat ? ' selected' : ''}>${esc(catLabel(c.name))}</option>`).join('')}</select></div>
          <div><label for="pe-sub">${t('Subcategory')}</label><select id="pe-sub" class="field" data-pe="sub"><option value="">${(cat.subs || []).length ? t('— choose —') : t('None')}</option>${(cat.subs || []).map(s => `<option value="${esc(s)}"${s === p.sub ? ' selected' : ''}>${esc(subLabel(p.cat, s))}</option>`).join('')}</select></div>
          ${f('stock', t('Pieces in stock'), 'number', 'min="0" step="1" required')}
          ${f('price', p._parts.length ? t('Price (full set)') : t('Price ({cur})', { cur: cur() }), 'number', 'min="0" step="1" required')}
          ${f('oldPrice', t('Old price — fill to show as sale'), 'number', 'min="0" step="1"')}
          <div class="full"><label for="pe-desc">${t('Description (English)')}</label><textarea id="pe-desc" class="field" dir="ltr" data-pe="desc" style="min-height:90px">${esc(p.desc)}</textarea></div>
        </div></div>
        <div class="adm-card"><h3>${t('DETAILS (ENGLISH)')}</h3><div class="frm" style="margin-top:14px">
          ${f('material', t('Material'))}${f('size', t('Size'))}${f('color', t('Color (as shown in details)'))}
          <div class="full"><label for="pe-comes">${t('Comes with — one per line')}</label><textarea id="pe-comes" class="field" dir="auto" data-pe="_comes" style="min-height:70px">${esc(p._comes)}</textarea></div>
        </div></div>
        <div class="adm-card"><h3>${t('ARABIC')}</h3><p class="note">${t('Shown when a customer switches the shop to Arabic. Leave a field empty to show the English.')}</p><div class="frm">
          <div class="full">${fa('nameAr', t('Name (Arabic)'))}</div>
          <div class="full"><label for="pe-descAr">${t('Description (Arabic)')}</label><textarea id="pe-descAr" class="field" dir="rtl" lang="ar" data-pe="descAr" style="min-height:90px">${esc(p.descAr || '')}</textarea></div>
          ${fa('materialAr', t('Material (Arabic)'))}${fa('sizeAr', t('Size (Arabic)'))}${fa('colorAr', t('Color (Arabic)'))}
          <div class="full"><label for="pe-comesAr">${t('Comes with (Arabic) — one per line')}</label><textarea id="pe-comesAr" class="field" dir="rtl" lang="ar" data-pe="_comesAr" style="min-height:70px">${esc(p._comesAr)}</textarea></div>
        </div></div>
        <div class="adm-card"><h3>${t('CUSTOMER CHOICES')}</h3><p class="note">${t("Only the choices you add here appear on this product's page. Customers must pick each one before adding to cart.")}</p>
          <label style="font-size:10px;color:var(--soft)">${t('COLORS')}</label>
          <div class="rows" style="margin:8px 0 18px">${p._colors.map((c, i) => `<div class="rowx c3"><input class="field" dir="ltr" placeholder="${t('Color name')}" data-color="${i}" data-k="name" value="${esc(c.name)}"><input class="field" dir="rtl" lang="ar" placeholder="${t('Arabic name')}" data-color="${i}" data-k="ar" value="${esc(c.ar || '')}"><input type="color" data-color="${i}" data-k="hex" value="${esc(c.hex || '#d4a62a')}"><button type="button" class="rm" data-act="rmColor" data-i="${i}" aria-label="${t('Remove')}">✕</button></div>`).join('')}
            <button type="button" class="add-row" data-act="addColor">+ ${t('ADD COLOR')}</button></div>
          <div class="checks" style="margin-bottom:18px"><label><input type="checkbox" data-pe="_letters"${p._letters ? ' checked' : ''}> ${t('Customer picks a necklace letter (A–Z)')}</label></div>
          <div class="frm">
            <div><label for="pe-ring">${t('Ring sizes')}</label><input id="pe-ring" class="field" dir="ltr" data-pe="_ring" placeholder="${t('e.g. 16, 17, 18, 19')}" value="${esc(p._ring)}"></div>
            <div><label for="pe-bag">${t('Bag sizes')}</label><input id="pe-bag" class="field" dir="ltr" data-pe="_bag" placeholder="${t('e.g. 16 × 9, 20 × 12')}" value="${esc(p._bag)}"></div>
          </div>
          <label style="font-size:10px;color:var(--soft);display:block;margin-top:18px">${t('SET PIECES — each with its own price')}</label>
          <div class="rows" style="margin-top:8px">${p._parts.map((x, i) => `<div class="rowx c4"><input class="field" dir="ltr" placeholder="${t('Piece (e.g. Necklace)')}" data-part="${i}" data-k="name" value="${esc(x.name)}"><input class="field" dir="rtl" lang="ar" placeholder="${t('Arabic name')}" data-part="${i}" data-k="ar" value="${esc(x.ar || '')}"><input class="field" type="number" min="0" placeholder="${t('Price')}" data-part="${i}" data-k="price" value="${esc(x.price)}"><button type="button" class="rm" data-act="rmPart" data-i="${i}" aria-label="${t('Remove')}">✕</button></div>`).join('')}
            <button type="button" class="add-row" data-act="addPart">+ ${t('ADD SET PIECE')}</button></div>
          ${p._parts.length ? `<div class="hint">${t('When all pieces are chosen, the customer pays the full-set price above.')}</div>` : ''}
        </div>
      </div>
      <div class="adm-grid">
        <div class="adm-card"><h3>${t('PHOTOS')}</h3><p class="note">${t('The first photo is the main one. Large photos are resized automatically.')}</p>
          <p class="hint" style="margin:-8px 0 14px">${t('Recommended: {size} (portrait 3:4), at least 900 × 1200. JPG, product centred on a plain background. You can crop each photo after choosing it.', { size: '<b>1200 × 1600 px</b>' })}</p>
          <div class="photos">${p.images.map((u, i) => `<div class="photo-item" style="background-image:url('${esc(u)}')">${i === 0 ? `<span class="main">${t('MAIN')}</span>` : ''}
              <div class="ctl"><button type="button" data-act="imgMove" data-i="${i}" data-d="-1" aria-label="${t('Move earlier')}">‹</button><button type="button" data-act="imgCrop" data-i="${i}" aria-label="${t('Crop')}" title="${t('Crop')}">✂</button><button type="button" data-act="imgRm" data-i="${i}" aria-label="${t('Remove')}">✕</button><button type="button" data-act="imgMove" data-i="${i}" data-d="1" aria-label="${t('Move later')}">›</button></div></div>`).join('')}
            <label class="photo-add">${A.ui.uploading ? t('UPLOADING…') : '+ ' + t('ADD PHOTOS')}<input type="file" id="pe-files" accept="image/*" multiple></label></div>
        </div>
        <div class="adm-card"><h3>${t('SIZE CHART')}</h3><p class="note">${t('Optional. Customers see a “Size chart” button on the product page.')}</p>
          <p class="hint" style="margin:-8px 0 12px">${t('A clear photo or screenshot of the size table, at least 1000 px wide.')}</p>
          ${p.sizeChart ? `<img class="chart-prev" src="${esc(p.sizeChart)}" alt="">` : ''}
          <div class="actions"><label class="btn btn-ink btn-sm upl">${A.ui.chartUp ? t('UPLOADING…') : p.sizeChart ? t('REPLACE IMAGE') : t('UPLOAD SIZE CHART')}<input type="file" id="pe-chart" accept="image/*" hidden></label>
            ${p.sizeChart ? `<button type="button" class="btn btn-line btn-sm" data-act="chartRm">${t('REMOVE')}</button>` : ''}</div>
        </div>
        <div class="adm-card"><h3>${t('VISIBILITY')}</h3>
          <div class="checks" style="flex-direction:column;gap:12px;margin-top:14px">
            <label><input type="checkbox" data-pe="active"${p.active ? ' checked' : ''}> ${t('Show in the shop')}</label>
            <label><input type="checkbox" data-flag="sale"${p.flags.sale ? ' checked' : ''}> ${t('On Sale row')}</label>
            <label><input type="checkbox" data-flag="best"${p.flags.best ? ' checked' : ''}> ${t('Best Sellers row')}</label>
            <label><input type="checkbox" data-flag="new"${p.flags.new ? ' checked' : ''}> ${t('New Collection row')}</label>
          </div>
          ${p._new ? '' : `<p class="note" style="margin-top:16px">${t('To remove a product, untick “Show in the shop”. Its past orders stay intact.')}</p>`}
        </div>
      </div>
    </div>
    <div class="save-bar"><button class="btn btn-gold" type="submit"${A.ui.saving ? ' disabled' : ''}>${A.ui.saving ? t('SAVING…') : p._new ? t('ADD PRODUCT') : t('SAVE CHANGES')}</button>
      <button type="button" class="btn btn-line" data-act="go" data-href="#/products">${t('CANCEL')}</button>
      <span class="msg${A.ui.editOk ? '' : ' err'}">${esc(A.ui.editMsg)}</span></div>
    </form>`;
}
function collectProduct() {
  const p = A.ui.edit;
  const list = s => s.split(',').map(x => x.trim()).filter(Boolean);
  const lines = s => (s || '').split('\n').map(x => x.trim()).filter(Boolean);
  const options = {};
  const colors = p._colors.filter(c => c.name.trim()).map(c => ({ name: c.name.trim(), hex: c.hex || '#d4a62a', ...(c.ar && c.ar.trim() ? { ar: c.ar.trim() } : {}) }));
  if (colors.length) options.colors = colors;
  if (p._letters) options.letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  if (list(p._ring).length) options.ringSizes = list(p._ring);
  if (list(p._bag).length) options.bagSizes = list(p._bag);
  const parts = p._parts.filter(x => x.name.trim()).map(x => ({ name: x.name.trim(), price: Math.round(+x.price || 0), ...(x.ar && x.ar.trim() ? { ar: x.ar.trim() } : {}) }));
  if (parts.length) options.setParts = parts;
  const cat = (A.settings.categories || []).find(c => c.name === p.cat);
  return {
    ...p, id: p._new ? (slug(p.name) + '-' + slug(p.code)).replace(/-+$/, '') : p.id,
    price: +p.price, oldPrice: p.oldPrice === '' || p.oldPrice == null ? 0 : +p.oldPrice, stock: +p.stock,
    comesWith: lines(p._comes), comesWithAr: lines(p._comesAr),
    nameAr: (p.nameAr || '').trim(), descAr: (p.descAr || '').trim(), materialAr: (p.materialAr || '').trim(), sizeAr: (p.sizeAr || '').trim(), colorAr: (p.colorAr || '').trim(),
    sub: (cat && (cat.subs || []).includes(p.sub)) ? p.sub : '',
    bg: p.bg || (cat && cat.bg), options,
  };
}
// resize big phone photos before upload (JPEG)
function shrink(file, maxSide = 1600) {
  return new Promise(res => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return res(file);
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      if (k === 1 && file.size < 900 * 1024) { URL.revokeObjectURL(url); return res(file); }
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => { URL.revokeObjectURL(url); res(b ? new File([b], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', 0.86);
    };
    img.onerror = () => { URL.revokeObjectURL(url); res(file); };
    img.src = url;
  });
}

// ───────────────────────── reviews ─────────────────────────
function viewReviews(tab) {
  if (tab) A.ui.rtab = tab;
  const cur = A.ui.rtab;
  const list = A.reviews.filter(r => cur === 'all' ? true : cur === 'pending' ? !r.approved : r.approved);
  const stars = n => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
  return head(t('Reviews'), t('Customer reviews appear on the home page only after you approve them.')) + `
    <div class="tabs2">${[['pending', 'Waiting for approval', A.reviews.filter(r => !r.approved).length], ['approved', 'Published', A.reviews.filter(r => r.approved).length], ['all', 'All', A.reviews.length]]
      .map(([k, l, n]) => `<button class="${cur === k ? 'on' : ''}" data-act="go" data-href="#/reviews/${k}">${t(l)}<i>${n}</i></button>`).join('')}</div>
    ${list.length ? `<div class="rcards">${list.map(r => `<div class="rcard"><div class="top"><span class="nm" dir="auto">${esc(r.name)}</span><span class="st">${stars(r.rating)}</span></div>
        <p dir="auto">${esc(r.text)}</p><div class="sm muted" style="font-size:11px">${fmtDT(r.created_at)} · ${r.approved ? `<span class="ok">${t('Published')}</span>` : t('Waiting')}</div>
        <div class="actions">${r.approved ? `<button class="btn btn-line btn-sm" data-act="revApprove" data-id="${r.id}" data-v="0">${t('HIDE')}</button>` : `<button class="btn btn-gold btn-sm" data-act="revApprove" data-id="${r.id}" data-v="1">${t('APPROVE')}</button>`}
          ${A.ui.delConfirm === r.id ? `<button class="btn btn-danger btn-sm" data-act="revDelete" data-id="${r.id}">${t('CONFIRM DELETE')}</button>` : `<button class="btn btn-line btn-sm" data-act="revDeleteAsk" data-id="${r.id}">${t('DELETE')}</button>`}</div></div>`).join('')}</div>`
      : `<div class="chart-empty">${t('Nothing here.')}</div>`}`;
}

// ───────────────────────── settings ─────────────────────────
// older settings had one switch (showSummary) for both
const revShow = (s, k) => { const r = s.reviews || {}; return r[k] != null ? r[k] !== false : r.showSummary !== false; };
function viewSettings() {
  const s = A.settings, pr = s.promo || {};
  if (!can('settings.edit')) return head(t('Settings')) + promosCard();
  const val = path => path.split('.').reduce((o, k) => (o || {})[k], s) || '';
  const inp = (path, label, ph = '', type = 'text', dir = '') => `<div><label>${label}</label><input class="field" type="${type}" data-set="${path}" placeholder="${esc(ph)}" value="${esc(val(path))}"${dir ? ` dir="${dir}"` : ''}></div>`;
  const inpAr = (path, label, ph = '') => inp(path, label, ph, 'text', 'rtl');
  const deliv = (s.delivery = Array.isArray(s.delivery) ? s.delivery : Object.entries(s.delivery || {}).map(([city, fee]) => ({ city, fee })));
  return head(t('Settings'), t('Changes apply to the shop as soon as you save.')) + `
    <form data-form="settings"><div class="adm-grid g2">
      <div class="adm-card"><h3>${t('SEASON BANNER')}</h3><p class="note">${t('The big banner at the top of the home page.')}</p>
        <div class="checks" style="margin-bottom:14px"><label><input type="checkbox" data-set="promo.enabled"${pr.enabled !== false ? ' checked' : ''}> ${t('Show the season banner')}</label></div>
        <div class="frm">${inp('promo.kicker', t('Small line above'), 'SEASON SALE · LIMITED TIME', 'text', 'ltr')}${inpAr('promo.kicker_ar', t('Small line above (Arabic)'), 'تخفيضات الموسم')}
          ${inp('promo.title', t('Title'), 'Black Friday', 'text', 'ltr')}${inpAr('promo.title_ar', t('Title (Arabic)'), 'البلاك فرايداي')}
          ${inp('promo.big', t('Big text'), '50%', 'text', 'ltr')}<div></div>
          ${inp('promo.small', t('Next to big text'), 'OFF', 'text', 'ltr')}${inpAr('promo.small_ar', t('Next to big text (Arabic)'), 'خصم')}
          <div class="full"><label>${t('Text')}</label><textarea class="field" dir="ltr" data-set="promo.text" style="min-height:70px">${esc(pr.text || '')}</textarea></div>
          <div class="full"><label>${t('Text (Arabic)')}</label><textarea class="field" dir="rtl" data-set="promo.text_ar" style="min-height:70px">${esc(pr.text_ar || '')}</textarea></div>
          ${inp('promo.cta', t('Button label'), 'SHOP THE SALE', 'text', 'ltr')}${inpAr('promo.cta_ar', t('Button label (Arabic)'), 'تسوق التخفيضات')}
          <div class="full"><label>${t('Background image')}</label>
            <div class="banner-prev"${pr.image ? ` style="background-image:url('${esc(pr.image)}')"` : ''}><div class="shade"></div><div class="txt"><small>${esc(I18N.pick(pr.kicker, pr.kicker_ar))}</small>${esc(I18N.pick(pr.title, pr.title_ar) || t('Banner'))}</div>${pr.image ? '' : `<span class="none">${t('No image — the gold gradient is used')}</span>`}</div>
            <div class="actions" style="margin-top:10px"><label class="btn btn-ink btn-sm upl">${A.ui.bannerUp ? t('UPLOADING…') : pr.image ? t('REPLACE IMAGE') : t('UPLOAD IMAGE')}<input type="file" id="banner-file" accept="image/jpeg,image/png,image/webp" hidden></label>
              ${pr.image ? `<button type="button" class="btn btn-line btn-sm" data-act="bannerRm">${t('REMOVE IMAGE')}</button>` : ''}</div>
            <div class="hint" style="margin-top:10px">${t('Recommended size: {size}, landscape (at least 1600 × 740), JPG or PNG. Larger photos are resized automatically.', { size: '<b>2400 × 1100 px</b>' })}<br>
              ${t('The text sits on the left in English and on the right in Arabic, so keep the main subject in the {centre}. On phones the picture is cropped to its centre.', { centre: `<b>${t('centre')}</b>` })}</div></div>
        </div></div>
      <div class="adm-card"><h3>${t('PAYMENT & CONTACT')}</h3><p class="note">${t('Shown to customers at checkout and on the contact pages.')}</p>
        <div class="frm">${inp('instapay', t('InstaPay / VC number'), '0100 111 1111', 'text', 'ltr')}${inp('whatsapp', t('WhatsApp (international, digits only)'), '201001111111', 'text', 'ltr')}
          ${inp('phone', t('Phone (display)'), '+20 100 111 1111', 'text', 'ltr')}${inp('email', t('Email'), 'hello@…', 'email')}
          ${inp('address', t('Boutique address'), 'Value Mall, New Cairo', 'text', 'ltr')}${inpAr('address_ar', t('Boutique address (Arabic)'), 'فاليو مول، القاهرة الجديدة')}
          ${inp('hours', t('Opening hours'), '', 'text', 'ltr')}${inpAr('hours_ar', t('Opening hours (Arabic)'))}
          ${inp('mapsUrl', t('Google Maps link'), '', 'text', 'ltr')}${inp('socials.facebook', t('Facebook link'), '', 'text', 'ltr')}
          ${inp('socials.instagram', t('Instagram link'), '', 'text', 'ltr')}${inp('socials.tiktok', t('TikTok link'), '', 'text', 'ltr')}
          <div class="full">${inp('instapayLink', t('InstaPay payment link (optional)'), 'https://ipn.eg/S/…', 'text', 'ltr')}</div>
          <div class="full">${inp('siteUrl', t('Shop address (used in emails)'), 'https://www.allure-boutique.org', 'text', 'ltr')}</div>
          <div class="full">${inp('dashboardUrl', t('Dashboard link (added to Telegram alerts)'), 'https://yourshop.com/admin.html', 'text', 'ltr')}</div></div></div>
      <div class="adm-card"><h3>${t('EMAILS TO CUSTOMERS')}</h3><p class="note">${t('Order confirmations are sent from this name and address. Replies go to the reply-to address.')}</p>
        <div class="frm">${inp('mailer.fromName', t('Sender name'), 'ALLURE Boutique')}${inp('mailer.fromEmail', t('Sender address'), 'orders@allure-boutique.org', 'email')}
          <div class="full">${inp('mailer.replyTo', t('Replies go to'), 'you@gmail.com', 'email')}</div></div>
        <p class="hint" style="margin-top:10px">${t('Setup and test: see Notifications.')}</p></div>
      <div class="adm-card"><h3>${t('REVIEWS ON THE HOME PAGE')}</h3>
        <div class="checks" style="margin-top:12px;flex-direction:column;align-items:flex-start;gap:10px">
          <label><input type="checkbox" data-set="reviews.showAverage"${revShow(s, 'showAverage') ? ' checked' : ''}> ${t('Show the average star rating')}</label>
          <label><input type="checkbox" data-set="reviews.showCount"${revShow(s, 'showCount') ? ' checked' : ''}> ${t('Show the number of reviews')}</label></div>
        <p class="hint" style="margin-top:10px">${t('Calculated from approved customer reviews.')}</p></div>
      <div class="adm-card"><h3>${t('DELIVERY FEES')}</h3><p class="note">${t('Customers choose their city at checkout. Branch pickup is always free.')}</p>
        <div class="rows">${deliv.map(({ city, fee, ar }, i) => `<div class="rowx c4"><input class="field" dir="ltr" data-deliv="${i}" data-k="city" value="${esc(city)}" placeholder="${t('City')}"><input class="field" dir="rtl" data-deliv="${i}" data-k="ar" value="${esc(ar || '')}" placeholder="${t('Arabic name')}"><input class="field" type="number" min="0" data-deliv="${i}" data-k="fee" value="${esc(fee)}" placeholder="${cur()}"><button type="button" class="rm" data-act="rmCity" data-i="${i}" aria-label="${t('Remove')}">✕</button></div>`).join('')}
          <button type="button" class="add-row" data-act="addCity">+ ${t('ADD CITY')}</button></div></div>
      <div class="adm-card"><h3>${t('CATEGORIES')}</h3><p class="note">${t('Names, order, pictures and subcategories are edited on their own page.')}</p>
        ${can('categories.edit') ? `<button type="button" class="btn btn-line btn-sm" data-act="go" data-href="#/categories">${t('EDIT CATEGORIES')} ${arrow()}</button>` : ''}</div>
    </div>
    <div class="save-bar"><button class="btn btn-gold" type="submit">${t('SAVE SETTINGS')}</button><span class="msg${A.ui.sOk ? '' : ' err'}">${esc(A.ui.sMsg)}</span></div>
    </form>
    ${can('promos.edit') ? promosCard() : ''}`;
}
function promosCard() {
  return `    <div class="adm-card mt"><h3>${t('DISCOUNT CODES')}</h3><p class="note">${t('Customers type these in the cart. The discount applies to the items, not delivery.')}</p>
      ${A.promos.length ? `<div class="atbl-wrap" style="margin-bottom:16px"><table class="atbl"><thead><tr><th>${t('CODE')}</th><th class="num">${t('DISCOUNT')}</th><th>${t('EXPIRES')}</th><th>${t('STATUS')}</th><th></th></tr></thead><tbody>
        ${A.promos.map(p => { const expired = p.expires_at && new Date(p.expires_at) < new Date(); return `<tr style="cursor:default"><td><b>${esc(p.code)}</b></td><td class="num">${p.percent}%</td><td>${p.expires_at ? fmtD(p.expires_at) : t('Never')}</td>
          <td>${expired ? `<span class="pill2 off">${t('EXPIRED')}</span>` : p.active ? `<span class="pill2 confirmed">${t('ACTIVE')}</span>` : `<span class="pill2 off">${t('PAUSED')}</span>`}</td>
          <td class="num"><button class="btn btn-line btn-sm" data-act="promoToggle" data-code="${esc(p.code)}">${p.active ? t('PAUSE') : t('ACTIVATE')}</button> <button class="btn btn-line btn-sm" data-act="promoDelete" data-code="${esc(p.code)}">${t('DELETE')}</button></td></tr>`; }).join('')}
      </tbody></table></div>` : ''}
      <form data-form="promo" class="frm promo-form">
        <div><label>${t('New code')}</label><input class="field" id="np-code" dir="ltr" placeholder="${t('e.g. EID15')}" value="${esc(A.ui.newPromo.code)}"></div>
        <div><label>${t('% off')}</label><input class="field" id="np-pct" type="number" min="1" max="90" value="${esc(A.ui.newPromo.percent)}"></div>
        <div><label>${t('Expires (optional)')}</label><input class="field" id="np-exp" type="date" value="${esc(A.ui.newPromo.expires)}"></div>
        <button class="btn btn-ink" type="submit" style="height:48px">${t('ADD CODE')}</button></form>
    </div>`;
}

// ───────────────────────── notifications ─────────────────────────
// Telegram: the owner creates the bot once; after that every team member connects their own Telegram with one tap.
function telegramCard() {
  const tg = A.ui.tg, c = A.ui.tgc || {};
  const saved = v => tg ? (v ? `<span class="ok">✓ ${t('Saved')}</span>` : `<span class="bad">${t('Not set')}</span>`) : '…';
  const chats = (tg && tg.chats) || [], mine = chats.filter(x => x.user_id === A.profile.id);
  const botReady = tg && tg.token;
  let connect = '';
  if (!can('orders.view')) connect = `<p class="note">${t('Order messages are only for team members who can see orders.')}</p>`;
  else if (!botReady) connect = `<p class="note">${isOwnerAcc() ? t('First create the bot (steps below). Then everyone can connect with one tap.') : t('The main owner needs to set up the Telegram bot first.')}</p>`;
  else if (c.code) connect = `<div class="tg-connect">
      <p class="note" style="margin-top:0">${c.bot ? t('Tap the button, then press {start} in Telegram. This page updates by itself.', { start: '<b>Start</b>' }) : t('Getting the bot ready…')}</p>
      ${c.bot ? `<div class="actions"><a class="btn btn-gold" href="https://t.me/${esc(c.bot)}?start=${esc(c.code)}" target="_blank" rel="noopener">${t('OPEN TELEGRAM')} ↗</a>
        <a class="btn btn-line" href="https://t.me/${esc(c.bot)}?startgroup=${esc(c.code)}" target="_blank" rel="noopener">${t('ADD TO A GROUP')} ↗</a>
        <button class="btn btn-line" data-act="tgStop">${t('CANCEL')}</button></div>
        <p class="hint" style="margin-top:10px">${t('On a computer, you can also scan this with your phone camera:')} <span dir="ltr">t.me/${esc(c.bot)}?start=${esc(c.code)}</span></p>` : ''}
      ${c.msg ? `<p class="note" style="margin-top:10px">${c.msg}</p>` : `<p class="note muted" style="margin-top:10px">⏳ ${t('Waiting for Telegram…')}</p>`}</div>`;
  else connect = `<div class="actions"><button class="btn btn-gold" data-act="tgConnect">${mine.length ? t('CONNECT ANOTHER CHAT') : t('CONNECT MY TELEGRAM')}</button>
      ${mine.length || isOwnerAcc() ? `<button class="btn btn-line" data-act="tgTest">${t('SEND TEST MESSAGE')}</button>` : ''}</div>`;
  return `<div class="adm-card"><h3>${t('TELEGRAM — ON YOUR PHONE')}</h3><p class="note">${t('A message for every new order, even when this dashboard is closed. Free.')}</p>
      ${connect}
      ${A.ui.tgMsg ? `<p class="note" style="margin-top:14px">${A.ui.tgMsg}</p>` : ''}
      ${chats.length ? `<h3 style="margin-top:22px">${isOwnerAcc() ? t('WHO GETS ORDER MESSAGES') : t('YOUR CONNECTED CHATS')}</h3>
        <div class="atbl-wrap"><table class="atbl"><tbody>${chats.map(x => `<tr style="cursor:default"><td><span dir="auto">${esc(x.title || x.chat_id)}</span><div class="sm">${x.kind === 'private' ? t('Private chat') : t('Group')}${isOwnerAcc() && x.who ? ' · ' + t('connected by {name}', { name: esc(x.who) }) : ''}</div></td>
          <td class="num"><button class="btn btn-line btn-sm" data-act="tgRemove" data-chat="${esc(x.chat_id)}">${t('DISCONNECT')}</button></td></tr>`).join('')}</tbody></table></div>` : ''}
      ${isOwnerAcc() ? `<details class="tg-setup"${botReady ? '' : ' open'}><summary>${t('Bot setup (main owner, once)')}</summary>
        <div class="kv" style="margin:12px 0"><span class="k">${t('BOT TOKEN')}</span><span>${saved(tg && tg.token)}</span>
          <span class="k">${t('MAIN CHAT')}</span><span>${tg && tg.chat ? `<span class="ok">✓ ${t('Saved')}</span>` : t('Optional')}</span></div>
        <ol class="steps">
          <li>${t('In Telegram, open {bf}, send {cmd}, choose a name (e.g. “ALLURE Orders”). It replies with a {token} like {ex}.', { bf: '<b>@BotFather</b>', cmd: '<b>/newbot</b>', token: `<b>${t('token')}</b>`, ex: '<code>123456:ABC-…</code>' })}</li>
          <li>${t('In Supabase → {sql}, run (with your values):', { sql: '<b>SQL Editor</b>' })}
            <div class="code">select vault.create_secret('PASTE_TOKEN', 'telegram_bot_token');</div></li>
          <li>${t('Come back here, press {a}, then {b}.', { a: `<b>${t('Refresh status')}</b>`, b: `<b>${t('Connect my Telegram')}</b>` })}</li>
        </ol>
        <div class="actions"><button class="btn btn-line btn-sm" data-act="tgRefresh">${t('REFRESH STATUS')}</button></div></details>` : ''}
    </div>`;
}
function viewNotifications() {
  // fresh status each time the page is opened (e.g. right after adding the bot token in Supabase)
  if (!A.ui.tgAt || Date.now() - A.ui.tgAt > 15000) {
    A.ui.tgAt = Date.now();
    API.admin.telegramStatus().then(st => { A.ui.tg = st; if (/notifications/.test(location.hash)) render(); }, () => {});
    if (can('settings.edit')) API.admin.emailStatus().then(st => { A.ui.es = st; if (/notifications/.test(location.hash)) render(); }, () => {});
  }
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  return head(t('Notifications'), t('How you hear about every new order.')) + `
    <div class="adm-grid g2">
      ${telegramCard()}
      ${can('settings.edit') ? emailCard() : ''}
      <div class="adm-card"><h3>${t('THIS BROWSER — WHILE THE DASHBOARD IS OPEN')}</h3><p class="note">${t('A sound and a pop-up on this computer or phone the moment an order arrives.')}</p>
        <div class="kv" style="margin:6px 0 16px"><span class="k">${t('POP-UPS')}</span><span>${perm === 'granted' ? `<span class="ok">✓ ${t('Allowed')}</span>` : perm === 'denied' ? `<span class="bad">${t('Blocked — allow notifications for this site in your browser settings')}</span>` : perm === 'unsupported' ? t('Not supported in this browser') : t('Not enabled yet')}</span>
          <span class="k">${t('SOUND')}</span><span>${A.prefs.sound ? `<span class="ok">✓ ${t('On')}</span>` : t('Off')}</span></div>
        <div class="actions">${perm === 'default' ? `<button class="btn btn-gold" data-act="notifAsk">${t('ENABLE POP-UPS')}</button>` : ''}
          <button class="btn btn-line" data-act="soundToggle">${A.prefs.sound ? t('TURN SOUND OFF') : t('TURN SOUND ON')}</button>
          <button class="btn btn-line" data-act="alertTest">${t('TEST ALERT')}</button></div>
        <p class="note" style="margin-top:16px">${t("Tip: keep this dashboard open in a browser tab on the shop's computer. The tab title also shows the number of new orders.")}</p></div>
    </div>`;
}

// ───────────────────────── insights ─────────────────────────
const SOURCE_LBL = { direct: 'Direct / typed link', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', google: 'Google', whatsapp: 'WhatsApp', twitter: 'X / Twitter', snapchat: 'Snapchat', bing: 'Bing' };
const DEVICE_LBL = { mobile: 'Phones', tablet: 'Tablets', desktop: 'Computers', unknown: 'Unknown' };
const DEVICE_ONE = { mobile: 'phone', tablet: 'tablet', desktop: 'computer', unknown: 'unknown' };
const titleCase = s => String(s).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
function pageLabel(p) {
  const [a, b, c] = String(p).split('/').filter(Boolean);
  if (!a) return t('Home');
  if (a === 'product') { const pr = A.products.find(x => x.id === b); return pr ? I18N.pick(pr.name, pr.nameAr) : t('Product') + ' · ' + titleCase(b || ''); }
  if (a === 'shop') {
    const cat = (A.settings.categories || []).find(x => slug(x.name) === b);
    const sub = cat && c ? (cat.subs || []).find(x => slug(x) === c) : null;
    if (b === 'all' || !b) return t('Shop') + ' · ' + t('All');
    if (['sale', 'best', 'new'].includes(b)) return t('Shop') + ' · ' + t({ sale: 'On Sale', best: 'Best Sellers', new: 'New Arrivals' }[b]);
    return t('Shop') + ' · ' + (cat ? catLabel(cat.name) + (sub ? ' · ' + subLabel(cat.name, sub) : '') : titleCase(b));
  }
  if (a === 'page') return t({ about: 'About Us', contact: 'Contact Us', location: 'Visit Us', policy: 'Our Policy', shipping: 'Shipping Policy', terms: 'Terms of Service' }[b] || titleCase(b || ''));
  return t({ cart: 'Cart', checkout: 'Checkout', favourites: 'Favourites', account: 'My Account', orders: 'My Orders', track: 'Track order', search: 'Search', order: 'Order confirmation', reviews: 'Reviews' }[a] || titleCase(a));
}
function summarizePresence(state) {
  const live = { online: 0, carts: 0, pieces: 0, checkout: 0, devices: {}, pages: {}, visitors: [] };
  Object.values(state || {}).forEach(metas => {
    if (!metas || !metas.length) return;
    const v = { cart: Math.max(...metas.map(m => m.cart || 0)), checkout: metas.some(m => m.checkout), device: metas[0].device || 'unknown',
      page: metas.reduce((a, m) => (m.since || 0) > (a.since || 0) ? m : a, metas[0]).page || '/', since: Math.min(...metas.map(m => m.since || Date.now())) };
    live.online++; if (v.cart) { live.carts++; live.pieces += v.cart; } if (v.checkout) live.checkout++;
    live.devices[v.device] = (live.devices[v.device] || 0) + 1;
    live.pages[v.page] = (live.pages[v.page] || 0) + 1;
    live.visitors.push(v);
  });
  return live;
}
const rankList = (rows, empty) => rows.length ? `<ul class="rank">${rows.map(([lbl, v, max, extra]) => `<li><span>${esc(lbl)}</span><span class="v">${num(v)}${extra ? ' · ' + extra : ''}</span><span class="meter"><i style="width:${Math.max(3, v / (max || 1) * 100)}%"></i></span></li>`).join('')}</ul>` : `<div class="chart-empty" style="padding:28px 0">${empty}</div>`;
const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
function loadInsights(force) {
  if (A.ui.insLoading || (!force && A.ins && A.insFor === A.ui.insDays)) return;
  A.ui.insLoading = true; A.ui.insErr = '';
  API.admin.insights(A.ui.insDays).then(r => { A.ins = r; A.insFor = A.ui.insDays; }, e => { A.ui.insErr = API.errMessage(e); })
    .then(() => { A.ui.insLoading = false; if (/^#\/insights/.test(location.hash)) render(); });
}
function viewInsights() {
  loadInsights();
  const lv = A.live, days = A.ui.insDays, I = A.ins && A.insFor === days ? A.ins : null;
  const seg = `<div style="display:flex;gap:10px;align-items:center">${daysSeg('insRange', days)}
    <button class="btn btn-line btn-sm" data-act="insRefresh">${A.ui.insLoading ? t('LOADING…') : t('REFRESH')}</button></div>`;
  const livePages = Object.entries(lv.pages).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const liveCarts = lv.visitors.filter(v => v.cart).sort((a, b) => b.checkout - a.checkout || b.cart - a.cart).slice(0, 8);
  const live = `<div class="adm-card live-card">
      <div class="live-h"><span class="dot"></span><h3>${t('LIVE NOW')}</h3><span class="note" style="margin:0">${t('Updates instantly · a visitor counts while the shop is open in their browser')}</span></div>
      <div class="tiles t4">
        <div class="tile big"><div class="lbl">${t('Visitors online')}</div><div class="val">${lv.online}</div><div class="delta">${Object.entries(lv.devices).map(([d, n]) => `${n} ${t(DEVICE_LBL[d] || d).toLowerCase()}`).join(' · ') || t('Nobody on the shop right now')}</div></div>
        <div class="tile"><div class="lbl">${t('Active carts')}</div><div class="val">${lv.carts}</div><div class="delta">${n1(lv.pieces, '{n} piece in carts', '{n} pieces in carts')}</div></div>
        <div class="tile"><div class="lbl">${t('At checkout now')}</div><div class="val">${lv.checkout}</div><div class="delta">${lv.checkout ? t('Filling in their details') : '—'}</div></div>
      </div>
      <div class="adm-grid g2 mt">
        <div><h3>${t('PAGES BEING VIEWED')}</h3>${rankList(livePages.map(([p, n]) => [pageLabel(p), n, livePages[0][1]]), t('No one browsing right now.'))}</div>
        <div><h3>${t('CARTS RIGHT NOW')}</h3>${liveCarts.length ? `<ul class="rank">${liveCarts.map(v => `<li><span>${v.checkout ? `<span class="pill2 awaiting">${t('AT CHECKOUT')}</span> ` : ''}${esc(pageLabel(v.page))}</span><span class="v">${n1(v.cart, '{n} piece', '{n} pieces')} · ${t(DEVICE_ONE[v.device] || v.device)}</span></li>`).join('')}</ul>` : `<div class="chart-empty" style="padding:28px 0">${t('No open carts right now.')}</div>`}</div>
      </div></div>`;
  if (!I) return head(t('Insights'), t('Anonymous visitor statistics — your own visits as owner are not counted.'), seg) + live +
    `<div class="adm-card mt"><div class="chart-empty">${A.ui.insErr ? `<span class="bad">${esc(A.ui.insErr)}</span><br>${t('If you just updated the site, run supabase/schema.sql again in the SQL Editor.')}` : t('Loading statistics…')}</div></div>`;
  const tt = I.totals, f = I.funnel;
  const steps = [['Visited the shop', f.sessions], ['Viewed a product', f.product], ['Added to cart', f.cart], ['Reached checkout', f.checkout], ['Placed an order', f.order]];
  const src = I.sources || [], dev = I.devices || [], pages = I.pages || [], prods = I.products || [];
  return head(t('Insights'), t('Anonymous visitor statistics since {date} — your own visits as owner are not counted.', { date: fmtD(I.since) }), seg) + live + `
    <div class="tiles mt">
      <div class="tile big"><div class="lbl">${t('Impressions (page views)')}</div><div class="val">${compact(tt.page_views)}</div><div class="delta">${t('{a} visits · {b} pages per visit', { a: num(tt.sessions), b: tt.sessions ? (tt.page_views / tt.sessions).toFixed(1) : '0' })}</div></div>
      <div class="tile"><div class="lbl">${t('Unique visitors')}</div><div class="val">${compact(tt.visitors)}</div></div>
      <div class="tile"><div class="lbl">${t('Product views')}</div><div class="val">${compact(tt.product_views)}</div></div>
      <div class="tile"><div class="lbl">${t('Added to cart')}</div><div class="val">${compact(tt.add_to_cart)}</div></div>
      <div class="tile"><div class="lbl">${t('Conversion rate')}</div><div class="val">${pct(f.order, f.sessions)}</div><div class="delta">${t('visits that ordered')}</div></div>
    </div>
    <div class="adm-grid g-main mt">
      <div class="adm-card"><h3>${t('IMPRESSIONS BY DAY')}</h3><p class="note">${t('Page views per day, last {n} days', { n: days })}</p><div class="chart-wrap" id="insChart"></div></div>
      <div class="adm-card"><h3>${t('SHOPPING FUNNEL')}</h3><p class="note">${t('Out of every visit in this period')}</p>
        <ul class="rank funnel">${steps.map(([l, n], i) => `<li><span>${t(l)}</span><span class="v">${num(n)} · ${pct(n, f.sessions)}</span><span class="meter"><i style="width:${Math.max(2, f.sessions ? n / f.sessions * 100 : 0)}%"></i></span>${i ? `<span class="drop">${steps[i - 1][1] ? t('{p}% dropped off from the step above', { p: Math.max(0, 100 - Math.round(n / steps[i - 1][1] * 100)) }) : ''}</span>` : ''}</li>`).join('')}</ul>
        <div class="abandon">${t('{n} abandoned carts — visitors who added pieces but didn’t order (idle over an hour).', { n: `<b>${num(I.abandoned)}</b>` })}</div>
      </div>
    </div>
    <div class="adm-grid g3 mt">
      <div class="adm-card"><h3>${t('WHERE VISITORS COME FROM')}</h3><p class="note">${t('Visits by source')}</p>${rankList(src.map(s => [t(SOURCE_LBL[s.source] || s.source), s.sessions, src[0].sessions]), t('No visits yet.'))}
        <p class="note" style="margin-top:12px">${t('Tip: add {utm} to links you post so they’re always recognised.', { utm: '<b dir="ltr">?utm_source=instagram</b>' })}</p></div>
      <div class="adm-card"><h3>${t('DEVICES')}</h3><p class="note">${t('Unique visitors')}</p>${rankList(dev.map(d => [t(DEVICE_LBL[d.device] || d.device), d.visitors, dev[0].visitors]), t('No visits yet.'))}</div>
      <div class="adm-card"><h3>${t('MOST VISITED PAGES')}</h3><p class="note">${t('Page views')}</p>${rankList(pages.map(p => [pageLabel(p.path), p.views, pages[0].views]), t('No visits yet.'))}</div>
    </div>
    <div class="adm-card mt"><h3>${t('PRODUCT INTEREST')}</h3><p class="note">${t('Most viewed pieces and how often they’re added to cart')}</p>
      ${prods.length ? `<div class="atbl-wrap"><table class="atbl"><thead><tr><th>${t('PRODUCT')}</th><th class="num">${t('VIEWS')}</th><th class="num">${t('ADDED TO CART')}</th><th class="num">${t('ADD RATE')}</th></tr></thead><tbody>
        ${prods.map(p => `<tr data-act="go" data-href="#/products/${esc(p.id)}"><td>${esc(prodName(p.id, p.name))}</td><td class="num">${num(p.views)}</td><td class="num">${num(p.adds)}</td><td class="num">${pct(p.adds, p.views)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="chart-empty">${t('No product views yet.')}</div>`}
    </div>`;
}
function drawInsightsChart() {
  const el = $('#insChart'); if (!el || !A.ins) return;
  const data = (A.ins.daily || []).map(d => ({ date: new Date(d.day + 'T12:00:00'), v: d.views, n: d.visitors }));
  if (!data.some(d => d.v)) { el.innerHTML = `<div class="chart-empty">${t('No visits recorded in this period yet.')}</div>`; return; }
  drawBars(el, data, v => t('{n} views', { n: num(v) }), d => `${fmtD(d.date)} · ${n1(d.n, '{n} visitor', '{n} visitors')}`, t('Impressions by day'));
}

// ───────────────────────── order management (edit · exchange · return/refund · delete) ─────────────────────────
function manageCard(o) {
  const f = A.ui.oform;
  const btn = (k, l, cls = 'btn-line') => `<button class="btn ${cls} btn-sm${f === k ? ' on' : ''}" data-act="oform" data-f="${k}">${t(l)}</button>`;
  let body = '';
  if (f === 'edit' || f === 'exchange') body = orderEditor(o, f);
  else if (f === 'refund') {
    const left = o.total - (o.refunded || 0);
    body = `<div class="frm" style="margin-top:14px">
        <div><label>${t('Amount to refund ({cur})', { cur: cur() })}</label><input class="field" type="number" min="0" max="${left}" id="rf-amount" value="${left}"></div>
        <div class="checks" style="align-items:end"><label><input type="checkbox" id="rf-restock"${o.restocked ? ' disabled' : ' checked'}> ${o.restocked ? t('Pieces are already back in stock') : t('The pieces came back — return them to stock')}</label></div>
        <div class="full"><label>${t('Note (reason, how it was refunded…)')}</label><input class="field" id="rf-note" dir="auto"></div></div>
      <div class="actions" style="margin-top:12px"><button class="btn btn-danger" data-act="doRefund">${t('CONFIRM RETURN / REFUND')}</button><button class="btn btn-line" data-act="oform" data-f="">${t('CANCEL')}</button></div>
      <p class="hint" style="margin-top:8px">${t('Up to {amount} can still be refunded. The order is marked “Returned / refunded”.', { amount: money(left) })}</p>`;
  } else if (f === 'delete') {
    body = `<p class="note" style="margin-top:14px">${t('Deleting removes the order completely — it disappears from reports, exports and the customer’s history. For real orders, use Cancel or Return / refund instead.')}</p>
      <div class="checks"><label><input type="checkbox" id="del-restock"${o.restocked ? ' disabled' : ' checked'}> ${o.restocked ? t('Pieces are already back in stock') : t('Return its pieces to stock')}</label></div>
      <div class="actions" style="margin-top:12px"><button class="btn btn-danger" data-act="doDelete">${t('DELETE PERMANENTLY')}</button><button class="btn btn-line" data-act="oform" data-f="">${t('KEEP ORDER')}</button></div>`;
  }
  return `<div class="adm-card"><h3>${t('MANAGE ORDER')}</h3>
    <div class="actions" style="margin-top:12px">${can('orders.edit') ? btn('edit', 'EDIT ORDER') + btn('exchange', 'EXCHANGE') : ''}${can('orders.refund') ? btn('refund', 'RETURN / REFUND') : ''}${can('orders.delete') ? btn('delete', 'DELETE', 'btn-danger') : ''}</div>
    ${body}</div>`;
}
function startOrderForm(o, f) {
  A.ui.oform = f;
  if (f === 'edit' || f === 'exchange') {
    A.ui.oedit = { customer: { ...o.customer }, fulfil: o.fulfil, city: o.city || '', address: o.address, delivery_fee: o.delivery_fee, payment: o.payment, customer_note: o.note || '',
      discount: o.discount, note: '', items: (o.items || []).map(i => ({ id: i.id, qty: i.qty, unit: i.unit, opts: { ...(i.opts || {}) }, name: i.name, code: i.code })) };
  }
}
function orderEditor(o, mode) {
  const d = A.ui.oedit, c = d.customer;
  const sub = d.items.reduce((a, i) => a + (+i.unit || 0) * (+i.qty || 0), 0);
  const total = Math.max(0, sub - (+d.discount || 0) + (+d.delivery_fee || 0));
  const prodOpts = sel => A.products.map(p => `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(I18N.pick(p.name, p.nameAr))} · #${esc(p.code)}${p.stock < 1 ? ' (' + t('out of stock') + ')' : ''}</option>`).join('');
  const optEditors = (it, i) => {
    const p = A.products.find(x => x.id === it.id); const op = (p && p.options) || {}; const out = [];
    const selectOf = (k, list, label) => `<select class="field" data-oi="${i}" data-k="${k}" aria-label="${label}"><option value="">${label}</option>${list.map(v => `<option${String(it.opts[k] || '') === String(v) ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
    if (op.colors) out.push(selectOf('color', op.colors.map(x => x.name), t('Color')));
    if (op.letters) out.push(selectOf('letter', op.letters, t('Letter')));
    if (op.ringSizes) out.push(selectOf('ringSize', op.ringSizes, t('Ring size')));
    if (op.bagSizes) out.push(selectOf('bagSize', op.bagSizes, t('Bag size')));
    if (op.setParts) out.push(`<div class="checks">${op.setParts.map(x => `<label><input type="checkbox" data-op="${i}" value="${esc(x.name)}"${(it.opts.parts || []).includes(x.name) ? ' checked' : ''}> ${esc(I18N.pick(x.name, x.ar))}</label>`).join('')}</div>`);
    return out.join('');
  };
  return `<div class="oedit">
    ${mode === 'exchange' ? `<p class="note" style="margin-top:14px">${t('Change the pieces to what the customer is taking instead. Returned pieces go back to stock, new ones are taken out, and the order is marked “Exchanged”.')}</p>` : ''}
    <h4>${t('PIECES')}</h4>
    ${d.items.map((it, i) => `<div class="oe-item">
      <select class="field" data-oi="${i}" data-k="id">${prodOpts(it.id)}</select>
      <div class="oe-row"><label>${t('Qty')}<input class="field" type="number" min="1" data-oi="${i}" data-k="qty" value="${esc(it.qty)}"></label>
        <label>${t('Unit price')}<input class="field" type="number" min="0" data-oi="${i}" data-k="unit" value="${esc(it.unit)}"></label>
        <button type="button" class="rm" data-act="oeRm" data-i="${i}" aria-label="${t('Remove')}">✕</button></div>
      <div class="oe-opts">${optEditors(it, i)}</div></div>`).join('')}
    <button type="button" class="add-row" data-act="oeAdd">+ ${t('ADD PIECE')}</button>
    <h4>${t('CUSTOMER & DELIVERY')}</h4>
    <div class="frm">
      <div><label>${t('Name')}</label><input class="field" dir="auto" data-oe="customer.name" value="${esc(c.name)}"></div>
      <div><label>${t('Phone')}</label><input class="field" type="tel" data-oe="customer.phone" value="${esc(c.phone)}"></div>
      <div><label>${t('Another phone (optional)')}</label><input class="field" type="tel" data-oe="customer.phone2" value="${esc(c.phone2 || '')}"></div>
      <div><label>${t('Email')}</label><input class="field" type="email" data-oe="customer.email" value="${esc(c.email || '')}"></div>
      <div><label>${t('Delivery')}</label><select class="field" data-oe="fulfil"><option value="delivery"${d.fulfil === 'delivery' ? ' selected' : ''}>${t('Deliver to my address')}</option><option value="pickup"${d.fulfil === 'pickup' ? ' selected' : ''}>${t('Receive from our branch')}</option></select></div>
      <div><label>${t('City')}</label><select class="field" data-oe="city"><option value=""></option>${(A.settings.delivery || []).map(x => `<option value="${esc(x.city)}"${x.city === d.city ? ' selected' : ''}>${esc(cityLabel(x.city))}</option>`).join('')}</select></div>
      <div class="full"><label>${t('Address')}</label><input class="field" dir="auto" data-oe="address" value="${esc(d.address)}"></div>
      <div><label>${t('Delivery fee ({cur})', { cur: cur() })}</label><input class="field" type="number" min="0" data-oe="delivery_fee" value="${esc(d.delivery_fee)}"></div>
      <div><label>${t('Discount ({cur})', { cur: cur() })}</label><input class="field" type="number" min="0" data-oe="discount" value="${esc(d.discount)}"></div>
      <div><label>${t('Payment method')}</label><select class="field" data-oe="payment">${Object.keys(PAY).map(k => `<option value="${k}"${d.payment === k ? ' selected' : ''}>${t(PAY[k])}</option>`).join('')}</select></div>
      <div><label>${t('Customer’s note')}</label><input class="field" dir="auto" data-oe="customer_note" value="${esc(d.customer_note || '')}"></div>
      <div class="full"><label>${mode === 'exchange' ? t('What was exchanged and why (required)') : t('Note about this change (optional)')}</label><input class="field" dir="auto" data-oe="note" value="${esc(d.note)}"></div>
    </div>
    <div class="oe-total">${t('New total')}: <b id="oeTotal">${money(total)}</b> <span class="muted">(${t('was {amount}', { amount: money(o.total) })})</span></div>
    <div class="actions" style="margin-top:12px"><button class="btn btn-gold" data-act="doEdit">${mode === 'exchange' ? t('SAVE EXCHANGE') : t('SAVE CHANGES')}</button><button class="btn btn-line" data-act="oform" data-f="">${t('CANCEL')}</button></div>
  </div>`;
}

// ───────────────────────── customers ─────────────────────────
function customerStats() {
  const C = A.customers || { accounts: [], guests: [], blocked_phones: [] };
  const buyers = {};
  A.orders.filter(o => o.status !== 'cancelled').forEach(o => { const k = o.user_id || 'p:' + o.customer.phone; buyers[k] = (buyers[k] || 0) + 1; });
  const counts = Object.values(buyers);
  const since = new Date(); since.setDate(since.getDate() - 29); since.setHours(0, 0, 0, 0);
  const all = [...C.accounts.filter(a => a.role === 'customer').map(a => ({ ...a, kind: 'account' })), ...C.guests.map(g => ({ ...g, kind: 'guest' }))];
  return {
    C, all,
    accounts: C.accounts.filter(a => a.role === 'customer').length,
    newAccounts: C.accounts.filter(a => a.role === 'customer' && new Date(a.created_at) >= since).length,
    guests: C.guests.length,
    buyers: counts.length,
    repeat: counts.length ? Math.round(counts.filter(n => n > 1).length / counts.length * 100) : 0,
    avgSpend: all.filter(x => +x.spent > 0).length ? all.reduce((a, x) => a + (+x.spent || 0), 0) / all.filter(x => +x.spent > 0).length : 0,
    top: all.filter(x => +x.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, 5),
    blocked: C.accounts.filter(a => a.blocked).length + C.blocked_phones.length,
  };
}
function viewCustomers(tab) {
  if (tab) A.ui.ctab = tab;
  const cur0 = A.ui.ctab || 'accounts';
  if (!A.customers) return head(t('Customers')) + `<div class="adm-card"><div class="chart-empty">${A.ui.custErr ? `<span class="bad">${esc(A.ui.custErr)}</span><br>${t('If you just updated the site, run supabase/schema.sql again in the SQL Editor.')}` : t('Loading…')}</div></div>`;
  const st = customerStats(), q = (A.ui.cq || '').trim().toLowerCase();
  const match = x => !q || [x.name, x.email, x.phone].join(' ').toLowerCase().includes(q);
  const tabs = [['accounts', 'Accounts', st.accounts], ['guests', 'Guest buyers', st.guests], ['blocked', 'Blocked', st.blocked]];
  let table = '';
  if (cur0 === 'accounts') {
    const list = st.C.accounts.filter(a => a.role === 'customer').filter(match);
    const phones = {}; st.C.accounts.forEach(a => { if (a.phone) phones[a.phone] = (phones[a.phone] || 0) + 1; });
    table = list.length ? `<div class="atbl-wrap"><table class="atbl"><thead><tr><th>${t('CUSTOMER')}</th><th class="hide-m">${t('PHONE')}</th><th class="num">${t('ORDERS')}</th><th class="num">${t('SPENT')}</th><th class="hide-m">${t('LAST ORDER')}</th><th class="hide-m">${t('JOINED')}</th><th></th></tr></thead><tbody>
      ${list.map(a => `<tr data-act="openCust" data-k="u:${esc(a.id)}"><td><span dir="auto">${esc(a.name || '—')}</span><div class="sm">${esc(a.email)}</div></td><td class="hide-m" dir="ltr">${esc(a.phone)}${phones[a.phone] > 1 ? ` <span class="pill2 off" title="${t('Another account has the same phone number')}">${t('SHARED')}</span>` : ''}</td>
        <td class="num">${a.orders}</td><td class="num">${money(a.spent)}</td><td class="hide-m">${a.last_order ? fmtD(a.last_order) : '—'}</td><td class="hide-m">${fmtD(a.created_at)}</td>
        <td>${a.blocked ? `<span class="pill2 awaiting">${t('BLOCKED')}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="chart-empty">${t('No customers match.')}</div>`;
  } else if (cur0 === 'guests') {
    const list = st.C.guests.filter(match);
    table = list.length ? `<div class="atbl-wrap"><table class="atbl"><thead><tr><th>${t('CUSTOMER')}</th><th>${t('PHONE')}</th><th class="num">${t('ORDERS')}</th><th class="num">${t('SPENT')}</th><th class="hide-m">${t('LAST ORDER')}</th><th></th></tr></thead><tbody>
      ${list.map(g => `<tr data-act="openCust" data-k="p:${esc(g.phone)}"><td><span dir="auto">${esc(g.name)}</span><div class="sm">${esc(g.email || '')}</div></td><td dir="ltr">${esc(g.phone)}</td>
        <td class="num">${g.orders}</td><td class="num">${money(g.spent)}</td><td class="hide-m">${fmtD(g.last_order)}</td><td>${g.blocked ? `<span class="pill2 awaiting">${t('BLOCKED')}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="chart-empty">${t('No guest buyers yet.')}</div>`;
  } else {
    const accs = st.C.accounts.filter(a => a.blocked);
    table = `<div class="adm-card"><h3>${t('BLOCK A PHONE NUMBER')}</h3><p class="note">${t('Blocked numbers can’t place orders, as a guest or with an account.')}</p>
        <form class="frm" data-form="blockPhone" style="grid-template-columns:1fr 2fr auto;align-items:end"><div><label>${t('Phone')}</label><input class="field" type="tel" id="bp-phone" placeholder="01xxxxxxxxx"></div>
        <div><label>${t('Reason (only you see this)')}</label><input class="field" id="bp-reason" dir="auto"></div><button class="btn btn-danger" type="submit" style="height:48px">${t('BLOCK')}</button></form></div>
      <div class="atbl-wrap mt"><table class="atbl"><thead><tr><th>${t('BLOCKED')}</th><th>${t('REASON')}</th><th class="hide-m">${t('SINCE')}</th><th></th></tr></thead><tbody>
        ${accs.map(a => `<tr style="cursor:default"><td>${esc(a.name || a.email)}<div class="sm">${t('Account')} · ${esc(a.email)}</div></td><td dir="auto">${esc(a.blocked_reason || '—')}</td><td class="hide-m">${a.blocked_at ? fmtD(a.blocked_at) : '—'}</td>
          <td class="num"><button class="btn btn-line btn-sm" data-act="unblockAcc" data-id="${esc(a.id)}">${t('UNBLOCK')}</button></td></tr>`).join('')}
        ${st.C.blocked_phones.map(b => `<tr style="cursor:default"><td dir="ltr">${esc(b.phone)}<div class="sm">${t('Phone number')}</div></td><td dir="auto">${esc(b.reason || '—')}</td><td class="hide-m">${fmtD(b.created_at)}</td>
          <td class="num"><button class="btn btn-line btn-sm" data-act="unblockPhone" data-p="${esc(b.phone)}">${t('UNBLOCK')}</button></td></tr>`).join('')}
        ${!accs.length && !st.C.blocked_phones.length ? `<tr style="cursor:default"><td colspan="4" class="muted">${t('Nobody is blocked.')}</td></tr>` : ''}</tbody></table></div>`;
  }
  const maxTop = st.top.length ? +st.top[0].spent : 1;
  return head(t('Customers'), t('Everyone who has an account or has ordered. Click a customer to see their orders, edit or block them.')) + `
    <div class="tiles">
      <div class="tile big"><div class="lbl">${t('Customer accounts')}</div><div class="val">${num(st.accounts)}</div><div class="delta">${t('{n} new in the last 30 days', { n: st.newAccounts })}</div></div>
      <div class="tile"><div class="lbl">${t('Guest buyers')}</div><div class="val">${num(st.guests)}</div></div>
      <div class="tile"><div class="lbl">${t('Repeat customers')}</div><div class="val">${st.repeat}%</div><div class="delta">${t('ordered more than once')}</div></div>
      <div class="tile"><div class="lbl">${t('Average spend')}</div><div class="val">${compact(st.avgSpend)}<small>${cur()}</small></div><div class="delta">${t('per customer')}</div></div>
      <div class="tile"><div class="lbl">${t('Blocked')}</div><div class="val">${st.blocked}</div></div>
    </div>
    <div class="adm-grid g-main mt">
      <div class="adm-card"><h3>${t('NEW ACCOUNTS BY DAY')}</h3><p class="note">${t('Sign-ups, last 30 days')}</p><div class="chart-wrap" id="custChart"></div></div>
      <div class="adm-card"><h3>${t('TOP CUSTOMERS')}</h3><p class="note">${t('By total spent')}</p>
        ${st.top.length ? `<ul class="rank">${st.top.map(x => `<li><span dir="auto">${esc(x.name || x.email || x.phone)}${x.kind === 'guest' ? ` <span class="pill2 off">${t('GUEST')}</span>` : ''}</span><span class="v">${money(x.spent)}</span><span class="meter"><i style="width:${Math.max(4, x.spent / maxTop * 100)}%"></i></span></li>`).join('')}</ul>` : `<div class="chart-empty">${t('No sales yet.')}</div>`}</div>
    </div>
    <div class="tabs2 mt">${tabs.map(([k, l, n]) => `<button class="${cur0 === k ? 'on' : ''}" data-act="go" data-href="#/customers/${k}">${t(l)}<i>${n}</i></button>`).join('')}</div>
    ${cur0 !== 'blocked' ? `<div class="atools"><input class="field" id="cq" type="search" placeholder="${t('Search name, email or phone')}" value="${esc(A.ui.cq || '')}"></div>` : ''}
    ${table}`;
}
function drawCustomerChart() {
  const el = $('#custChart'); if (!el || !A.customers) return;
  const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 29);
  const data = []; for (let i = 0; i < 30; i++) { const d = new Date(from); d.setDate(d.getDate() + i); data.push({ key: dayKey(d), date: d, v: 0 }); }
  const idx = Object.fromEntries(data.map((x, i) => [x.key, i]));
  A.customers.accounts.forEach(a => { if (a.role !== 'customer') return; const i = idx[dayKey(a.created_at)]; if (i != null) data[i].v++; });
  if (!data.some(d => d.v)) { el.innerHTML = `<div class="chart-empty">${t('No new accounts in the last 30 days.')}</div>`; return; }
  drawBars(el, data, v => n1(v, '{n} new account', '{n} new accounts'), d => fmtD(d.date), t('New accounts by day'));
}
function openCustomer(k) { location.hash = '#/customer/' + encodeURIComponent(k); }
// everything about one customer (account "u:<id>" or guest "p:<phone>")
function custData(k) {
  if (!A.customers || !k) return null;
  const isAcc = k.startsWith('u:'), key = k.slice(2);
  const a = isAcc ? A.customers.accounts.find(x => x.id === key) : null;
  const g = !isAcc ? A.customers.guests.find(x => x.phone === key) : null;
  const who = a || g; if (!who) return null;
  const orders = A.orders.filter(o => isAcc ? o.user_id === key : (!o.user_id && o.customer.phone === key));
  return { isAcc, key, a, g, who, orders };
}
function customerInsights(orders) {
  const live = orders.filter(o => o.status !== 'cancelled');
  const spent = live.reduce((x, o) => x + net(o), 0), refunded = orders.reduce((x, o) => x + (o.refunded || 0), 0);
  const cats = {}, prods = {}, pay = {}, ful = {}, cities = {}, st = {};
  live.forEach(o => {
    (o.items || []).forEach(i => {
      const p = A.products.find(x => x.id === i.id); const c = p ? catLabel(p.cat) : t('Other');
      cats[c] = (cats[c] || 0) + i.qty; prods[i.id] = prods[i.id] || { name: prodName(i.id, i.name), qty: 0, spent: 0 };
      prods[i.id].qty += i.qty; prods[i.id].spent += i.qty * i.unit;
    });
    pay[t(PAY[o.payment])] = (pay[t(PAY[o.payment])] || 0) + 1;
    ful[o.fulfil === 'pickup' ? t('Branch pickup') : t('Delivery')] = (ful[o.fulfil === 'pickup' ? t('Branch pickup') : t('Delivery')] || 0) + 1;
    if (o.city) cities[cityLabel(o.city)] = (cities[cityLabel(o.city)] || 0) + 1;
  });
  orders.forEach(o => { st[o.status] = (st[o.status] || 0) + 1; });
  const dates = orders.map(o => new Date(o.created_at)).sort((x, y) => x - y);
  return { live, spent, refunded, avg: live.length ? spent / live.length : 0, cats, prods: Object.values(prods).sort((x, y) => y.qty - x.qty).slice(0, 6),
    pay, ful, cities, st, first: dates[0], last: dates[dates.length - 1], pieces: live.reduce((x, o) => x + (o.items || []).reduce((y, i) => y + i.qty, 0), 0) };
}
const rankOf = (obj, empty) => { const rows = Object.entries(obj).sort((x, y) => y[1] - x[1]); const max = rows.length ? rows[0][1] : 1; return rankList(rows.map(([l, v]) => [l, v, max]), empty); };
function viewCustomer(k, tab) {
  if (!A.customers) return backLink('#/customers', t('Customers')) + head(t('Customer')) + `<div class="adm-card"><p class="note">${A.ui.custErr ? esc(A.ui.custErr) : t('Loading…')}</p></div>`;
  const d = custData(k);
  if (!d) return backLink('#/customers', t('Customers')) + head(t('Customer')) + `<div class="adm-card"><p class="note" style="margin:0">${t('This customer could not be found.')}</p></div>`;
  const { isAcc, key, a, g, who, orders } = d;
  A.ui.cust = k; A.ui.custName = who.name || who.email || who.phone;
  const cur0 = tab || 'overview', ins = customerInsights(orders);
  const phone = who.phone || '';
  const phoneBlocked = (A.customers.blocked_phones || []).some(b => b.phone === phone);
  const blocked = (a && a.blocked) || (!isAcc && phoneBlocked);
  const shared = isAcc && phone && A.customers.accounts.filter(x => x.phone === phone).length > 1;
  const tabs = [['overview', 'Overview'], ['orders', 'Orders', orders.length], ...(isAcc ? [['addresses', 'Addresses']] : []), ['details', 'Details & blocking'], ...(can('activity.view') && isAcc ? [['activity', 'Activity']] : [])];
  const base = '#/customer/' + encodeURIComponent(k);
  let body = '';
  if (cur0 === 'overview') {
    const since = ins.last ? Math.floor((Date.now() - ins.last) / 864e5) : null;
    body = `<div class="tiles">
        <div class="tile big"><div class="lbl">${t('Total spent')}</div><div class="val">${compact(ins.spent)}<small>${cur()}</small></div><div class="delta">${t('after refunds, without cancelled orders')}</div></div>
        <div class="tile"><div class="lbl">${t('Orders')}</div><div class="val">${ins.live.length}</div><div class="delta">${n1(ins.pieces, '{n} piece', '{n} pieces')}</div></div>
        <div class="tile"><div class="lbl">${t('Average order')}</div><div class="val">${compact(ins.avg)}<small>${cur()}</small></div></div>
        <div class="tile"><div class="lbl">${t('Last order')}</div><div class="val">${since == null ? '—' : since === 0 ? t('Today') : n1(since, '{n} day ago', '{n} days ago')}</div><div class="delta">${ins.first ? t('first order {date}', { date: fmtD(ins.first) }) : ''}</div></div>
        <div class="tile"><div class="lbl">${t('Refunded')}</div><div class="val">${compact(ins.refunded)}<small>${cur()}</small></div><div class="delta">${n1(ins.st.cancelled || 0, '{n} cancelled', '{n} cancelled')}</div></div>
      </div>
      <div class="adm-grid g-main mt">
        <div class="adm-card"><h3>${t('SPENDING BY MONTH')}</h3><p class="note">${t('Last 12 months')}</p><div class="chart-wrap" id="custSpend"></div></div>
        <div class="adm-card"><h3>${t('MOST BOUGHT')}</h3>${ins.prods.length ? `<ul class="rank">${ins.prods.map(p => `<li><span dir="auto">${esc(p.name)}</span><span class="v">× ${p.qty} · ${money(p.spent)}</span><span class="meter"><i style="width:${Math.max(4, p.qty / ins.prods[0].qty * 100)}%"></i></span></li>`).join('')}</ul>` : `<div class="chart-empty">${t('No purchases yet.')}</div>`}</div>
      </div>
      <div class="adm-grid g3 mt">
        <div class="adm-card"><h3>${t('FAVOURITE CATEGORIES')}</h3>${rankOf(ins.cats, t('No purchases yet.'))}</div>
        <div class="adm-card"><h3>${t('HOW THEY ORDER')}</h3>${rankOf({ ...ins.pay, ...ins.ful }, t('No purchases yet.'))}</div>
        <div class="adm-card"><h3>${t('ORDER STATUSES')}</h3>${rankOf(Object.fromEntries(Object.entries(ins.st).map(([k2, v]) => [t(STATUS_LBL[k2] || k2), v])), t('No orders yet.'))}</div>
      </div>
      ${a && a.staff_note ? `<div class="adm-card mt"><h3>${t('TEAM NOTE')}</h3><p dir="auto" style="white-space:pre-wrap;margin:8px 0 0">${esc(a.staff_note)}</p></div>` : ''}`;
  } else if (cur0 === 'orders') {
    body = orders.length ? ordersTable(orders) : `<div class="adm-card"><p class="note" style="margin:0">${t('No orders yet.')}</p></div>`;
  } else if (cur0 === 'addresses') {
    body = addressesBlock(key);
  } else if (cur0 === 'details') {
    const guestOrdersSamePhone = isAcc && phone ? A.orders.filter(o => !o.user_id && o.customer.phone === phone).length : 0;
    const editable = can('customers.edit');
    body = `<div class="adm-grid g2">
      <div class="adm-card"><h3>${t('DETAILS')}</h3>
        ${isAcc ? `<form class="frm" data-form="custEdit" style="margin-top:12px">
            <div><label>${t('Name')}</label><input class="field" dir="auto" id="ce-name" value="${esc(a.name)}"${editable ? '' : ' disabled'}></div>
            <div><label>${t('Phone')}</label><input class="field" type="tel" id="ce-phone" value="${esc(a.phone)}"${editable ? '' : ' disabled'}></div>
            <div class="full"><label>${t('Email')}</label><input class="field" type="email" value="${esc(a.email)}" disabled><p class="hint">${t('Customers change their email from their own account (it needs confirming).')}</p></div>
            <div class="full"><label>${t('Team note (only the team sees this)')}</label><textarea class="field" id="ce-note" dir="auto" style="min-height:80px"${editable ? '' : ' disabled'}>${esc(a.staff_note || '')}</textarea></div>
            ${editable ? `<div class="full"><button class="btn btn-ink btn-sm" type="submit">${t('SAVE CHANGES')}</button></div>` : ''}</form>`
          : `<form class="frm" data-form="guestEdit" style="margin-top:12px">
            <div><label>${t('Name')}</label><input class="field" dir="auto" id="ge-name" value="${esc(g.name)}"${editable ? '' : ' disabled'}></div>
            <div><label>${t('Phone')}</label><input class="field" type="tel" id="ge-phone" value="${esc(g.phone)}"${editable ? '' : ' disabled'}></div>
            <div class="full"><label>${t('Email')}</label><input class="field" type="email" id="ge-email" value="${esc(g.email || '')}"${editable ? '' : ' disabled'}></div>
            <p class="hint full">${t('Guests have no account — changes are made on all their orders.')}</p>
            ${editable && can('orders.edit') ? `<div class="full"><button class="btn btn-ink btn-sm" type="submit">${t('SAVE CHANGES')}</button></div>` : ''}</form>`}
        ${phone ? `<div class="actions" style="margin-top:14px"><a class="btn btn-gold btn-sm" href="https://wa.me/2${esc(phone)}" target="_blank" rel="noopener">${t('WHATSAPP')}</a><a class="btn btn-line btn-sm" href="tel:${esc(phone)}">${t('CALL')}</a></div>` : ''}
      </div>
      <div>
      <div class="adm-card"><h3>${t('BLOCKING')}</h3>
        ${!can('customers.block') ? `<p class="note">${blocked ? t('Blocked.') : t('Not blocked.')}</p>` : blocked
          ? `<p class="note" style="margin-top:10px">${t('Blocked — can’t place orders or post reviews.')}${a && a.blocked_reason ? ' ' + t('Reason: {r}', { r: esc(a.blocked_reason) }) : ''}</p>
             <button class="btn btn-line btn-sm" data-act="${isAcc ? 'unblockAcc' : 'unblockPhone'}" data-id="${isAcc ? esc(key) : ''}" data-p="${isAcc ? '' : esc(key)}">${t('UNBLOCK')}</button>`
          : `<p class="note" style="margin-top:10px">${isAcc ? t('Blocks the account and its phone number from ordering and posting reviews.') : t('Blocks this phone number from placing orders.')}</p>
             <div class="frm" style="grid-template-columns:1fr auto;align-items:end"><div><label>${t('Reason (only you see this)')}</label><input class="field" id="cb-reason" dir="auto"></div>
             <button class="btn btn-danger btn-sm" style="height:44px" data-act="${isAcc ? 'blockAcc' : 'blockGuest'}" data-id="${esc(key)}">${t('BLOCK')}</button></div>`}
      </div>
      ${isAcc ? `<div class="adm-card mt"><h3>${t('GUEST ORDERS')}</h3>
        <p class="note" style="margin-top:10px">${t('Guest orders with the same phone AND email join this account automatically once the email is confirmed.')}</p>
        ${guestOrdersSamePhone ? `<p class="note">${n1(guestOrdersSamePhone, 'There is {n} guest order with this phone but a different email.', 'There are {n} guest orders with this phone but a different email.')}</p>
          ${can('customers.edit') && can('orders.edit') ? `<button class="btn btn-ink btn-sm" data-act="linkGuest" data-id="${esc(key)}" data-p="${esc(phone)}">${t('ADD THEM TO THIS ACCOUNT')}</button>` : ''}` : `<p class="note">${t('No other guest orders with this phone.')}</p>`}</div>` : ''}
      </div></div>`;
  } else if (cur0 === 'activity') {
    body = `<div class="adm-grid g2">${activityCard('profiles', key, t('CHANGES TO THIS ACCOUNT'))}${activityCard('addresses', key, t('ADDRESS CHANGES'))}</div>`;
  }
  return backLink('#/customers', t('Customers')) + `<div class="adm-h"><div><h1 dir="auto">${esc(who.name || who.email || who.phone)}</h1>
      <div class="sub">${isAcc ? t('Account') + ' · ' + esc(a.email) + ' · ' + t('joined {date}', { date: fmtD(a.created_at) }) : t('Guest buyer')}${phone ? ` · <span dir="ltr">${esc(phone)}</span>` : ''}</div></div>
      <div class="actions">${blocked ? `<span class="pill2 awaiting">${t('BLOCKED')}</span>` : ''}${shared ? `<span class="pill2 off">${t('SHARED PHONE')}</span>` : ''}</div></div>
    <div class="tabs2">${tabs.map(([k2, l, n]) => `<button class="${cur0 === k2 ? 'on' : ''}" data-act="go" data-href="${base}/${k2}">${t(l)}${n != null ? `<i>${n}</i>` : ''}</button>`).join('')}</div>
    ${body}`;
}
function drawCustomerSpend() {
  const el = $('#custSpend'), d = custData(A.ui.cust); if (!el || !d) return;
  const now = new Date(), data = [];
  for (let i = 11; i >= 0; i--) { const m = new Date(now.getFullYear(), now.getMonth() - i, 1); data.push({ key: m.getFullYear() + '-' + m.getMonth(), date: m, v: 0, axis: m.toLocaleDateString(I18N.locale(), { month: 'short' }) }); }
  const idx = Object.fromEntries(data.map((x, i) => [x.key, i]));
  d.orders.filter(o => o.status !== 'cancelled').forEach(o => { const c = new Date(o.created_at); const i = idx[c.getFullYear() + '-' + c.getMonth()]; if (i != null) data[i].v += net(o); });
  if (!data.some(x => x.v)) { el.innerHTML = `<div class="chart-empty">${t('No purchases in the last 12 months.')}</div>`; return; }
  drawBars(el, data, v => money(v), x => x.date.toLocaleDateString(I18N.locale(), { month: 'short', year: '2-digit' }), t('Spending by month'));
}
// saved addresses of one customer (also used by the shop's own account page through the same table)
function addressesBlock(userId) {
  const st = A.ui.addr && A.ui.addr.user === userId ? A.ui.addr : (A.ui.addr = { user: userId, loading: true, list: [], form: null });
  if (st.loading && !st.req) { st.req = API.addresses(userId).then(list => { Object.assign(st, { list, loading: false }); render(); }, e => { Object.assign(st, { loading: false, err: API.errMessage(e) }); render(); }); }
  const editable = can('customers.edit'), f = st.form;
  const cities = (A.settings.delivery || []).map(x => x.city);
  const form = f ? `<form class="adm-card frm" data-form="addrSave" style="margin-top:14px">
      <div><label>${t('Label (e.g. Home, Work)')}</label><input class="field" dir="auto" data-af="label" value="${esc(f.label || '')}"></div>
      <div><label>${t('City')}</label><select class="field" data-af="city"><option value=""></option>${[...new Set([...cities, f.city].filter(Boolean))].map(c => `<option value="${esc(c)}"${c === f.city ? ' selected' : ''}>${esc(cityLabel(c))}</option>`).join('')}</select></div>
      <div><label>${t('Region / area')}</label><input class="field" dir="auto" data-af="region" value="${esc(f.region || '')}"></div>
      <div><label>${t('Street')}</label><input class="field" dir="auto" data-af="street" value="${esc(f.street || '')}"></div>
      <div><label>${t('Building')}</label><input class="field" dir="auto" data-af="building" value="${esc(f.building || '')}"></div>
      <div><label>${t('Apartment / floor')}</label><input class="field" dir="auto" data-af="apartment" value="${esc(f.apartment || '')}"></div>
      <div class="full checks"><label><input type="checkbox" data-af="is_default"${f.is_default ? ' checked' : ''}> ${t('Default address')}</label></div>
      <div class="full actions"><button class="btn btn-ink btn-sm" type="submit">${t('SAVE ADDRESS')}</button><button type="button" class="btn btn-line btn-sm" data-act="addrCancel">${t('CANCEL')}</button></div></form>` : '';
  return `${st.loading ? `<p class="note">${t('Loading…')}</p>` : st.err ? `<p class="note bad">${esc(st.err)}</p>` : ''}
    <div class="addr-grid">${st.list.map(x => `<div class="adm-card addr"><div class="nm">${esc(x.label || t('Address'))}${x.is_default ? ` <span class="pill2 confirmed">${t('DEFAULT')}</span>` : ''}</div>
      <div dir="auto">${esc([x.apartment, x.building, x.street, x.region, cityLabel(x.city)].filter(Boolean).join(', '))}</div>
      ${editable ? `<div class="actions" style="margin-top:12px"><button class="btn btn-line btn-sm" data-act="addrEdit" data-id="${x.id}">${t('EDIT')}</button>${x.is_default ? '' : `<button class="btn btn-line btn-sm" data-act="addrDefault" data-id="${x.id}">${t('MAKE DEFAULT')}</button>`}<button class="btn btn-line btn-sm" data-act="addrDelete" data-id="${x.id}">${t('DELETE')}</button></div>` : ''}</div>`).join('')}
    ${!st.loading && !st.list.length ? `<div class="adm-card"><p class="note" style="margin:0">${t('No saved addresses yet.')}</p></div>` : ''}</div>
    ${editable && !f ? `<button class="add-row" style="margin-top:14px" data-act="addrNew">+ ${t('ADD ADDRESS')}</button>` : ''}${form}`;
}

// ───────────────────────── categories ─────────────────────────
// Edit names (English + Arabic), order, tile picture or colours and subcategories. Renaming or removing
// moves the products with it, so nothing is left in a category that no longer exists.
const gradColors = bg => { const m = String(bg || '').match(/#[0-9a-f]{6}/gi) || []; return [m[0] || '#e0cd9e', m[1] || m[0] || '#b18f48']; };
function catDraft() {
  if (!A.ui.cats) {
    A.ui.cats = JSON.parse(JSON.stringify(A.settings.categories || [])).map(c => ({ ...c, _from: c.name,
      _subs: (c.subs || []).map(x => ({ name: x, ar: (c.subs_ar || {})[x] || '', _from: x })) }));
    A.ui.catGone = [];   // removed categories: { from, to (draft object) }
    A.ui.catMsg = '';
  }
  return A.ui.cats;
}
const catCount = (cat, sub) => A.products.filter(p => p.cat === cat && (sub === undefined || p.sub === sub)).length;
function viewCategories() {
  const cats = catDraft(), dirty = JSON.stringify(cats.map(catClean)) !== JSON.stringify(A.settings.categories || []) || A.ui.catGone.length;
  const card = (c, i) => {
    const n = c._from ? catCount(c._from) : 0, [c1, c2] = gradColors(c.bg), del = A.ui.catDel === i;
    return `<div class="adm-card cat-ed">
      <div class="cat-ed-h">
        <div class="tile-prev" style="background:${c.image ? `url('${esc(c.image)}') center/cover` : esc(c.bg || '')}"><span>${esc(c.tag || (c.name || '').toUpperCase())}</span></div>
        <div class="frm">
          <div><label>${t('Name')}</label><input class="field" dir="ltr" data-cat="${i}" data-k="name" value="${esc(c.name)}"></div>
          <div><label>${t('Arabic name')}</label><input class="field" dir="rtl" data-cat="${i}" data-k="ar" value="${esc(c.ar || '')}"></div>
          <div><label>${t('Label on the picture')}</label><input class="field" dir="ltr" data-cat="${i}" data-k="tag" value="${esc(c.tag || '')}" placeholder="${esc((c.name || '').toUpperCase())}"></div>
          <div><label>${t('Label on the picture (Arabic)')}</label><input class="field" dir="rtl" data-cat="${i}" data-k="tag_ar" value="${esc(c.tag_ar || '')}" placeholder="${esc(c.ar || '')}"></div>
        </div>
        <div class="cat-ed-tools">
          <button type="button" class="btn btn-line btn-sm" data-act="catMove" data-i="${i}" data-d="-1"${i ? '' : ' disabled'} aria-label="${t('Move up')}">↑</button>
          <button type="button" class="btn btn-line btn-sm" data-act="catMove" data-i="${i}" data-d="1"${i < cats.length - 1 ? '' : ' disabled'} aria-label="${t('Move down')}">↓</button>
          <button type="button" class="btn btn-line btn-sm" data-act="catDelAsk" data-i="${i}" aria-label="${t('Remove')}">✕</button>
        </div>
      </div>
      ${del ? `<div class="cat-del">${n ? `<label>${n1(n, 'Move its {n} product to', 'Move its {n} products to')}</label>
          <select class="field" id="cat-move-to">${cats.filter((x, j) => j !== i).map(x => `<option value="${cats.indexOf(x)}">${esc(x.name)}</option>`).join('')}</select>` : `<p class="note" style="margin:0">${t('No products in this category.')}</p>`}
        <div class="actions"><button type="button" class="btn btn-danger btn-sm" data-act="catDel" data-i="${i}">${t('REMOVE CATEGORY')}</button><button type="button" class="btn btn-line btn-sm" data-act="catDelNo">${t('KEEP')}</button></div></div>` : ''}
      <div class="cat-ed-look">
        <div><label>${t('Tile picture')}</label><div class="actions">
          <label class="btn btn-line btn-sm" style="cursor:pointer">${c.image ? t('CHANGE PICTURE') : t('UPLOAD PICTURE')}<input type="file" accept="image/*" data-catimg="${i}" hidden></label>
          ${c.image ? `<button type="button" class="btn btn-line btn-sm" data-act="catImgRm" data-i="${i}">${t('REMOVE PICTURE')}</button>` : ''}</div>
          <p class="hint">${t('Portrait 3:4, about {size}.', { size: '900 × 1200 px' })}</p></div>
        <div><label>${t('Colours (used when there is no picture)')}</label><div class="actions">
          <input type="color" data-catcol="${i}" data-n="0" value="${c1}" aria-label="${t('Colour 1')}"><input type="color" data-catcol="${i}" data-n="1" value="${c2}" aria-label="${t('Colour 2')}"></div></div>
      </div>
      <h4 class="cat-sub-h">${t('SUBCATEGORIES')} <span class="muted">· ${n1(n, '{n} product', '{n} products')}</span></h4>
      <div class="sub-rows">${c._subs.map((x, j) => { const sn = c._from && x._from ? catCount(c._from, x._from) : 0; const sd = A.ui.subDel === i + ':' + j; return `<div class="sub-row">
          <input class="field" dir="ltr" data-sub="${i}:${j}" data-k="name" value="${esc(x.name)}" placeholder="${t('Name')}">
          <input class="field" dir="rtl" data-sub="${i}:${j}" data-k="ar" value="${esc(x.ar)}" placeholder="${t('Arabic name')}">
          <span class="sm muted">${sn}</span>
          <span class="sub-tools"><button type="button" class="rm" data-act="subMove" data-i="${i}" data-j="${j}" data-d="-1"${j ? '' : ' disabled'} aria-label="${t('Move up')}">↑</button><button type="button" class="rm" data-act="subMove" data-i="${i}" data-j="${j}" data-d="1"${j < c._subs.length - 1 ? '' : ' disabled'} aria-label="${t('Move down')}">↓</button><button type="button" class="rm" data-act="subDelAsk" data-i="${i}" data-j="${j}" aria-label="${t('Remove')}">✕</button></span>
          ${sd ? `<div class="sub-del">${sn ? `<label>${n1(sn, 'Move its {n} product to', 'Move its {n} products to')}</label><select class="field" id="sub-move-to"><option value="">${t('No subcategory')}</option>${c._subs.filter((y, k) => k !== j).map(y => `<option>${esc(y.name)}</option>`).join('')}</select>` : ''}
            <button type="button" class="btn btn-danger btn-sm" data-act="subDel" data-i="${i}" data-j="${j}">${t('REMOVE')}</button><button type="button" class="btn btn-line btn-sm" data-act="subDelNo">${t('KEEP')}</button></div>` : ''}</div>`; }).join('')}
        <button type="button" class="add-row" data-act="subAdd" data-i="${i}">+ ${t('ADD SUBCATEGORY')}</button></div>
    </div>`;
  };
  return head(t('Categories'), t('What customers see in the menu, the filters and the home page tiles.'), `<button class="btn btn-line" data-act="catAdd">+ ${t('ADD CATEGORY')}</button>`) + `
    <div class="cat-list">${cats.map(card).join('')}</div>
    <div class="save-bar"><button class="btn btn-gold" data-act="catSave"${dirty ? '' : ' disabled'}>${t('SAVE CATEGORIES')}</button>
      ${dirty ? `<button class="btn btn-line" data-act="catReset">${t('DISCARD CHANGES')}</button>` : ''}<span class="msg${A.ui.catOk ? '' : ' err'}">${esc(A.ui.catMsg || '')}</span></div>`;
}
// the shape stored in settings.categories
function catClean(c) {
  const out = {}; Object.keys(c).forEach(k => { if (k[0] !== '_') out[k] = c[k]; });
  out.name = (c.name || '').trim(); out.ar = (c.ar || '').trim();
  out.subs = c._subs.map(x => x.name.trim());
  out.subs_ar = Object.fromEntries(c._subs.filter(x => x.ar.trim()).map(x => [x.name.trim(), x.ar.trim()]));
  if (!out.tag) delete out.tag; if (!out.tag_ar) delete out.tag_ar; if (!out.image) delete out.image;
  return out;
}
async function saveCategories() {
  const cats = catDraft(), clean = cats.map(catClean), moves = [];
  if (clean.some(c => !c.name) || clean.some(c => c.subs.some(x => !x))) { A.ui.catMsg = t('Every category and subcategory needs a name.'); A.ui.catOk = false; return render(); }
  cats.forEach(c => {
    if (!c._from) return;
    c._subs.forEach(x => { if (x._from && (x.name.trim() !== x._from || c.name.trim() !== c._from)) moves.push({ cat: c._from, sub: x._from, to_cat: c.name.trim(), to_sub: x.name.trim() }); });
    (c._subGone || []).forEach(g => moves.push({ cat: c._from, sub: g.from, to_cat: c.name.trim(), to_sub: g.to || null }));
    if (c.name.trim() !== c._from) moves.push({ cat: c._from, to_cat: c.name.trim(), keep_sub: true });
  });
  A.ui.catGone.forEach(g => moves.push({ cat: g.from, to_cat: g.to ? g.to.name.trim() : '', to_sub: null }));
  try {
    await API.admin.saveCategories(clean, moves);
    A.settings = await API.admin.settings(); A.products = await API.admin.products();
    A.ui.cats = null; catDraft(); A.ui.catMsg = t('Saved — the shop is updated.'); A.ui.catOk = true;
  } catch (e) { A.ui.catMsg = API.errMessage(e); A.ui.catOk = false; }
  render();
}

// ───────────────────────── team (main owner) ─────────────────────────
const ALL_PERMS = PERM_GROUPS.flatMap(g => g[1].map(x => x[0]));
const PERM_PRESETS = [
  ['Order handling', ['orders.view', 'orders.manage', 'customers.view']],
  ['Shop manager', ['products.edit', 'categories.edit', 'reviews.manage', 'pages.edit', 'promos.edit']],
  ['Everything (no team)', ALL_PERMS],
];
const permLabel = k => { for (const g of PERM_GROUPS) { const x = g[1].find(y => y[0] === k); if (x) return t(x[1]); } return k; };
function permPicker(scope, list) {
  return `<div class="perm-presets">${PERM_PRESETS.map(([l, ps], i) => `<button type="button" class="btn btn-line btn-sm" data-act="permPreset" data-scope="${scope}" data-i="${i}">${t(l)}</button>`).join('')}
      <button type="button" class="btn btn-line btn-sm" data-act="permPreset" data-scope="${scope}" data-i="-1">${t('Clear')}</button></div>
    <div class="perm-grid">${PERM_GROUPS.map(([g, items]) => `<div class="perm-group"><h4>${t(g)}</h4>${items.map(([k, l]) => `<label class="perm"><input type="checkbox" data-perm="${k}" data-scope="${scope}"${list.includes(k) ? ' checked' : ''}> ${t(l)}</label>`).join('')}</div>`).join('')}</div>`;
}
function loadTeam() { A.ui.teamLoading = true; API.admin.team().then(r => { A.team = r; A.ui.teamLoading = false; render(); }, e => { A.ui.teamLoading = false; A.ui.teamErr = API.errMessage(e); render(); }); }
function viewTeam() {
  if (!A.team && !A.ui.teamLoading && !A.ui.teamErr) loadTeam();
  const ns = A.ui.newStaff || (A.ui.newStaff = { name: '', email: '', perms: ['orders.view', 'orders.manage', 'customers.view'] });
  const tm = A.team || { staff: [], invites: [] };
  const member = m => {
    const ed = A.ui.staffEdit && A.ui.staffEdit.id === m.id ? A.ui.staffEdit : null, rm = A.ui.staffRm === m.id;
    const owner = m.role === 'owner';
    return `<div class="adm-card staff">
      <div class="staff-h"><div class="avatar-sm">${esc((m.name || m.email || '?').trim().charAt(0).toUpperCase())}</div>
        <div style="flex:1;min-width:0"><div class="nm" dir="auto">${esc(m.name || m.email)}${m.id === A.profile.id ? ` <span class="muted">(${t('you')})</span>` : ''}</div>
          <div class="sm muted">${esc(m.email)} · ${m.last_sign_in ? t('last signed in {date}', { date: fmtDT(m.last_sign_in) }) : t('never signed in')}</div></div>
        ${owner ? `<span class="pill2 confirmed">${t('MAIN OWNER')}</span>` : m.suspended ? `<span class="pill2 off">${t('PAUSED')}</span>` : !m.confirmed ? `<span class="pill2 awaiting">${t('EMAIL NOT CONFIRMED')}</span>` : `<span class="pill2 confirmed">${t('ACTIVE')}</span>`}</div>
      ${owner ? `<p class="note" style="margin:12px 0 0">${t('Full access to everything, including the team.')}</p>`
        : ed ? `<div style="margin-top:14px">${permPicker('edit', ed.perms)}
            <div class="actions" style="margin-top:12px"><button class="btn btn-gold btn-sm" data-act="staffSave">${t('SAVE ACCESS')}</button><button class="btn btn-line btn-sm" data-act="staffEditNo">${t('CANCEL')}</button></div></div>`
        : `<div class="chips-sm">${(m.perms || []).length ? m.perms.map(k => `<span>${esc(permLabel(k))}</span>`).join('') : `<span class="muted">${t('No access yet')}</span>`}</div>
          <div class="actions" style="margin-top:12px"><button class="btn btn-line btn-sm" data-act="staffEdit" data-id="${m.id}">${t('EDIT ACCESS')}</button>
            <button class="btn btn-line btn-sm" data-act="staffPause" data-id="${m.id}" data-v="${m.suspended ? 0 : 1}">${m.suspended ? t('RESUME ACCESS') : t('PAUSE ACCESS')}</button>
            ${can('activity.view') ? `<button class="btn btn-line btn-sm" data-act="actFor" data-id="${m.id}">${t('SEE ACTIVITY')}</button>` : ''}
            ${rm ? `<button class="btn btn-danger btn-sm" data-act="staffRemove" data-id="${m.id}">${t('CONFIRM — REMOVE FROM TEAM')}</button><button class="btn btn-line btn-sm" data-act="staffRmNo">${t('KEEP')}</button>`
              : `<button class="btn btn-line btn-sm" data-act="staffRmAsk" data-id="${m.id}">${t('REMOVE')}</button>`}</div>`}
    </div>`;
  };
  return head(t('Team'), t('Give partners or staff their own login with only the access they need. Everything they do is recorded on the Activity page.')) + `
    <div class="adm-grid g-main">
      <div>${A.ui.teamLoading && !A.team ? `<div class="adm-card"><p class="note">${t('Loading…')}</p></div>` : A.ui.teamErr ? `<div class="adm-card"><p class="note bad">${esc(A.ui.teamErr)}</p></div>` : tm.staff.map(member).join('')}
        ${tm.invites.length ? `<div class="adm-card"><h3>${t('WAITING FOR SIGN-UP')}</h3>${tm.invites.map(i => `<div class="log-row"><b>${esc(i.name || i.email)}</b> · ${esc(i.email)} <button class="link-btn" data-act="inviteCancel" data-email="${esc(i.email)}">${t('CANCEL')}</button></div>`).join('')}</div>` : ''}</div>
      <form class="adm-card" data-form="staffAdd"><h3>${t('ADD A TEAM MEMBER')}</h3>
        <p class="note">${t('Creates their login. They confirm their email, then sign in to this dashboard.')}</p>
        <div class="frm" style="grid-template-columns:1fr">
          <div><label>${t('Name')}</label><input class="field" dir="auto" id="ns-name" value="${esc(ns.name)}"></div>
          <div><label>${t('Email')}</label><input class="field" type="email" id="ns-email" value="${esc(ns.email)}" autocomplete="off"></div>
          <div><label>${t('Temporary password (6+ characters)')}</label><input class="field" type="text" id="ns-pw" autocomplete="new-password" dir="ltr"><p class="hint">${t('Share it with them privately. They can change it under My account.')}</p></div>
        </div>
        <h3 style="margin:22px 0 10px">${t('WHAT THEY CAN DO')}</h3>
        ${permPicker('new', ns.perms)}
        ${A.ui.staffMsg ? `<p class="note" style="margin-top:12px">${A.ui.staffMsg}</p>` : ''}
        <button class="btn btn-gold btn-block" style="margin-top:16px" type="submit"${A.ui.staffBusy ? ' disabled' : ''}>${A.ui.staffBusy ? t('PLEASE WAIT…') : t('ADD TO TEAM')}</button>
      </form>
    </div>`;
}

// ───────────────────────── activity log ─────────────────────────
const SET_KEYS = { promo: 'season banner', delivery: 'delivery fees', pages: 'policy pages', categories: 'categories', mailer: 'email sender', reviews: 'review display',
  instapay: 'InstaPay number', instapayLink: 'InstaPay link', whatsapp: 'WhatsApp', phone: 'phone', email: 'contact email', address: 'address', address_ar: 'address', hours: 'opening hours', hours_ar: 'opening hours',
  mapsUrl: 'map link', socials: 'social links', siteUrl: 'shop address', dashboardUrl: 'dashboard link' };
const FIELD_LBL = { status: 'status', payment_status: 'payment', admin_note: 'internal note', items: 'pieces', total: 'total', subtotal: 'subtotal', delivery_fee: 'delivery fee',
  discount: 'discount', customer: 'customer details', fulfil: 'delivery / pickup', city: 'city', address: 'address', note: 'customer’s note', payment: 'payment method', refunded: 'refund',
  user_id: 'account', name: 'name', price: 'price', old_price: 'old price', stock: 'stock', active: 'shown in shop', images: 'photos', description: 'description', cat: 'category',
  sub: 'subcategory', flags: 'labels', options: 'options', size_chart: 'size chart', code: 'code', material: 'material', size: 'size', color: 'colour', comes_with: 'comes with',
  phone: 'phone', staff_note: 'team note', blocked_reason: 'block reason', percent: 'discount %', expires_at: 'expiry', label: 'label', region: 'area', street: 'street',
  building: 'building', apartment: 'apartment', is_default: 'default address', perms: 'access', approved: 'approved' };
const fieldNames = (d, map) => [...new Set(Object.keys(d).map(k => /_ar$/.test(k) && !map[k] ? t('Arabic text') : t(map[k] || k)))].join(', ');
const fmtVal = v => v == null || v === '' ? '—' : typeof v === 'boolean' ? (v ? t('Yes') : t('No')) : typeof v === 'number' ? num(v)
  : typeof v === 'string' ? (/^\d{4}-\d\d-\d\dT/.test(v) ? fmtDT(v) : v.length > 90 ? v.slice(0, 90) + '…' : v) : (s => s.length > 90 ? s.slice(0, 90) + '…' : s)(JSON.stringify(v));
function actText(r) {
  const who = `<b dir="auto">${esc(r.actor_name || t('Someone'))}</b>`, d = r.details || {}, ch = d, id = esc(r.entity_id), lbl = `<span dir="auto">${esc(r.label || '')}</span>`;
  const link = (href, txt) => `<a href="${esc(href)}">${txt}</a>`;
  const ord = link('#/order/' + encodeURIComponent(r.entity_id), id);
  const keys = Object.keys(ch);
  switch (r.entity) {
    case 'dashboard': return r.action === 'sign_in' ? t('{who} signed in ({where})', { who, where: esc(t(r.label || 'computer')) }) : t('{who} exported to Excel ({what})', { who, what: esc(r.label) });
    case 'orders':
      if (r.action === 'delete') return t('{who} deleted order {no}', { who, no: id });
      if (r.action === 'insert') return t('{who} placed order {no}', { who, no: ord });
      if (ch.status && keys.every(k => ['status', 'refunded', 'payment_status'].includes(k))) return t('{who} moved order {no} from {a} to {b}', { who, no: ord, a: t(STATUS_LBL[ch.status[0]] || ch.status[0]), b: `<b>${t(STATUS_LBL[ch.status[1]] || ch.status[1])}</b>` });
      if (keys.length === 1 && ch.payment_status) return t('{who} marked the payment of order {no} as {b}', { who, no: ord, b: `<b>${t(PAY_ST[ch.payment_status[1]] || ch.payment_status[1])}</b>` });
      if (keys.length === 1 && ch.admin_note) return t('{who} edited the internal note of order {no}', { who, no: ord });
      if (ch.user_id) return t('{who} added order {no} to a customer account', { who, no: ord });
      return t('{who} edited order {no}: {fields}', { who, no: ord, fields: esc(fieldNames(ch, FIELD_LBL)) });
    case 'products': {
      const pl = link('#/products/' + encodeURIComponent(r.entity_id), lbl);
      if (r.action === 'insert') return t('{who} added product {name}', { who, name: pl });
      if (r.action === 'delete') return t('{who} deleted product {name}', { who, name: lbl });
      if (keys.length === 1 && ch.active) return ch.active[1] ? t('{who} showed {name} in the shop', { who, name: pl }) : t('{who} hid {name} from the shop', { who, name: pl });
      return t('{who} edited product {name}: {fields}', { who, name: pl, fields: esc(fieldNames(ch, FIELD_LBL)) });
    }
    case 'settings': return t('{who} changed the settings: {fields}', { who, fields: esc(fieldNames(ch, SET_KEYS)) });
    case 'promo_codes': return r.action === 'insert' ? t('{who} added discount code {code}', { who, code: `<b>${id}</b>` }) : r.action === 'delete' ? t('{who} deleted discount code {code}', { who, code: `<b>${id}</b>` })
      : ch.active ? (ch.active[1] ? t('{who} activated discount code {code}', { who, code: `<b>${id}</b>` }) : t('{who} paused discount code {code}', { who, code: `<b>${id}</b>` })) : t('{who} changed discount code {code}', { who, code: `<b>${id}</b>` });
    case 'reviews': return r.action === 'delete' ? t('{who} deleted a review by {name}', { who, name: lbl }) : ch.approved && ch.approved[1] ? t('{who} approved a review by {name}', { who, name: lbl }) : t('{who} hid a review by {name}', { who, name: lbl });
    case 'profiles': {
      const cl = link('#/customer/' + encodeURIComponent('u:' + r.entity_id), lbl);
      if (ch.role) return ch.role[1] === 'admin' ? t('{who} added {name} to the team', { who, name: lbl }) : ch.role[0] === 'admin' ? t('{who} removed {name} from the team', { who, name: lbl }) : t('{who} changed the role of {name}', { who, name: lbl });
      if (ch.suspended) return ch.suspended[1] ? t('{who} paused the access of {name}', { who, name: lbl }) : t('{who} resumed the access of {name}', { who, name: lbl });
      if (ch.perms) return t('{who} changed what {name} can do', { who, name: lbl });
      if (ch.blocked) return ch.blocked[1] ? t('{who} blocked {name}', { who, name: cl }) : t('{who} unblocked {name}', { who, name: cl });
      return t('{who} edited customer {name}: {fields}', { who, name: cl, fields: esc(fieldNames(ch, FIELD_LBL)) });
    }
    case 'blocked_phones': return r.action === 'delete' ? t('{who} unblocked phone {phone}', { who, phone: `<span dir="ltr">${id}</span>` }) : t('{who} blocked phone {phone}', { who, phone: `<span dir="ltr">${id}</span>` });
    case 'addresses': { const cl = link('#/customer/' + encodeURIComponent('u:' + r.entity_id) + '/addresses', lbl || t('address'));
      return r.action === 'insert' ? t('{who} added a customer address ({name})', { who, name: cl }) : r.action === 'delete' ? t('{who} deleted a customer address ({name})', { who, name: cl }) : t('{who} edited a customer address ({name})', { who, name: cl }); }
    case 'staff_invites': return r.action === 'delete' ? t('{who} cancelled the team invite for {email}', { who, email: id }) : t('{who} invited {email} to the team', { who, email: id });
    case 'telegram_chats': return r.action === 'delete' ? t('{who} disconnected Telegram ({name})', { who, name: lbl }) : t('{who} connected Telegram ({name})', { who, name: lbl });
    default: return t('{who} changed {what}', { who, what: esc(r.entity) });
  }
}
function actRow(r, compact) {
  const ch = r.action === 'update' ? Object.entries(r.details || {}) : [];
  const shown = ch.slice(0, 12);
  return `<div class="act-row"><span class="when">${compact ? fmtDT(r.at) : new Date(r.at).toLocaleTimeString(I18N.locale(), { hour: '2-digit', minute: '2-digit' })}</span>
    <div class="what">${actText(r)}${shown.length ? `<details><summary>${t('details')}</summary><div class="diff">${shown.map(([k, v]) => `<div><span class="k">${esc(r.entity === 'settings' ? t(SET_KEYS[k] || k) : t(FIELD_LBL[k] || k))}</span> <span class="old">${esc(fmtVal(v[0]))}</span> ${arrow()} <span class="new">${esc(fmtVal(v[1]))}</span></div>`).join('')}</div></details>` : ''}</div></div>`;
}
const ACT_AREAS = [['', 'Everything'], ['orders', 'Orders'], ['customers', 'Customers'], ['products', 'Products'], ['settings', 'Settings & codes'], ['reviews', 'Reviews'], ['team', 'Team & Telegram'], ['dashboard', 'Sign-ins & exports']];
const AREA_OF = { orders: 'orders', profiles: 'customers', addresses: 'customers', blocked_phones: 'customers', products: 'products', settings: 'settings', promo_codes: 'settings',
  reviews: 'reviews', staff_invites: 'team', telegram_chats: 'team', dashboard: 'dashboard' };
function loadActivity(more) {
  const f = A.ui.actF, from = f.days ? new Date(Date.now() - f.days * 864e5).toISOString() : null;
  const before = more && A.act.length ? A.act[A.act.length - 1].at : null;
  A.ui.actLoading = true;
  API.admin.activity({ actor: f.actor || null, from, before, limit: 300 }).then(rows => {
    A.act = more ? A.act.concat(rows) : rows; A.ui.actMore = rows.length === 300; A.ui.actLoading = false; render();
  }, e => { A.ui.actLoading = false; A.ui.actErr = API.errMessage(e); render(); });
}
function viewActivity() {
  const f = A.ui.actF || (A.ui.actF = { actor: '', area: '', days: 7 });
  if (!A.act && !A.ui.actLoading) loadActivity();
  const rows = (A.act || []).filter(r => !f.area || (r.entity === 'profiles' && f.area === 'team' && (r.details.role || r.details.perms || r.details.suspended)) || AREA_OF[r.entity] === f.area);
  const people = {}; (A.act || []).forEach(r => { if (r.actor) people[r.actor] = r.actor_name; }); (A.team ? A.team.staff : []).forEach(m => { people[m.id] = m.name || m.email; });
  let day = '', html = '';
  rows.forEach(r => { const d = new Date(r.at).toLocaleDateString(I18N.locale(), { weekday: 'long', day: 'numeric', month: 'long' }); if (d !== day) { html += `<div class="act-day">${esc(d)}</div>`; day = d; } html += actRow(r); });
  return head(t('Activity'), t('Every change made in the dashboard — who, what and when — with the details before and after.')) + `
    <div class="atools act-filters">
      <select class="field" id="af-actor"><option value="">${t('Everyone')}</option>${Object.entries(people).map(([id, n]) => `<option value="${esc(id)}"${f.actor === id ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <select class="field" id="af-area">${ACT_AREAS.map(([k, l]) => `<option value="${k}"${f.area === k ? ' selected' : ''}>${t(l)}</option>`).join('')}</select>
      <div class="seg">${[[1, 'TODAY'], [7, '7 DAYS'], [30, '30 DAYS'], [0, 'ALL']].map(([d, l]) => `<button class="${f.days === d ? 'on' : ''}" data-act="actDays" data-d="${d}">${t(l)}</button>`).join('')}</div>
    </div>
    <div class="adm-card act-list">${A.ui.actErr ? `<p class="note bad">${esc(A.ui.actErr)}</p>` : !A.act ? `<p class="note">${t('Loading…')}</p>` : rows.length ? html : `<p class="note">${t('Nothing in this period.')}</p>`}
      ${A.ui.actMore ? `<div style="text-align:center;margin-top:14px"><button class="btn btn-line btn-sm" data-act="actMore"${A.ui.actLoading ? ' disabled' : ''}>${t('LOAD MORE')}</button></div>` : ''}</div>`;
}

// ───────────────────────── my account ─────────────────────────
function viewMe() {
  const p = A.profile;
  return head(t('My account'), esc(p.email)) + `<div class="adm-grid g2">
    <form class="adm-card" data-form="meSave"><h3>${t('DETAILS')}</h3>
      <div class="frm" style="grid-template-columns:1fr;margin-top:12px"><div><label>${t('Name')}</label><input class="field" dir="auto" id="me-name" value="${esc(p.name)}"></div>
        <div><label>${t('Email')}</label><input class="field" value="${esc(p.email)}" disabled></div></div>
      <button class="btn btn-ink btn-sm" style="margin-top:14px" type="submit">${t('SAVE CHANGES')}</button></form>
    <form class="adm-card" data-form="mePw"><h3>${t('CHANGE PASSWORD')}</h3>
      <div class="frm" style="grid-template-columns:1fr;margin-top:12px"><div><label>${t('New password (6+ characters)')}</label><input class="field" type="password" id="me-pw" autocomplete="new-password"></div>
        <div><label>${t('Repeat the new password')}</label><input class="field" type="password" id="me-pw2" autocomplete="new-password"></div></div>
      <button class="btn btn-ink btn-sm" style="margin-top:14px" type="submit">${t('SAVE PASSWORD')}</button></form>
    <div class="adm-card"><h3>${t('YOUR ACCESS')}</h3>${isOwnerAcc() ? `<p class="note">${t('Main owner — full access to everything, including the team.')}</p>`
      : `<div class="chips-sm" style="margin-top:12px">${(p.perms || []).map(k => `<span>${esc(permLabel(k))}</span>`).join('') || `<span class="muted">${t('No access yet')}</span>`}</div><p class="note" style="margin-top:12px">${t('Only the main owner can change this.')}</p>`}</div>
    ${activityCardBy(p.id)}
  </div>`;
}
function activityCardBy(actor) {
  const c = A.ui.myAct || (A.ui.myAct = { loading: true, rows: [] });
  if (c.loading && !c.req) c.req = API.admin.activity({ actor, limit: 30 }).then(rows => { A.ui.myAct = { rows, req: 1 }; render(); }, () => { A.ui.myAct = { rows: [], req: 1 }; });
  return `<div class="adm-card"><h3>${t('YOUR RECENT ACTIVITY')}</h3>${c.loading ? `<p class="note">${t('Loading…')}</p>` : c.rows.length ? `<div class="act-list compact">${c.rows.map(r => actRow(r, true)).join('')}</div>` : `<p class="note">${t('Nothing yet.')}</p>`}</div>`;
}

// ───────────────────────── policy pages ─────────────────────────
function viewPages(slug0) {
  const slug = PAGES.slugs.includes(slug0) ? slug0 : (A.ui.pslug || 'policy'); A.ui.pslug = slug;
  const pages = A.settings.pages = A.settings.pages || {}; const pg = pages[slug] = pages[slug] || { en: '', ar: '' };
  const names = { policy: 'Our Policy', shipping: 'Shipping Policy', terms: 'Terms of Service' };
  const box = (l, dir, label) => `<div class="adm-card"><div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap"><h3>${label}</h3>
      <button type="button" class="tbl-toggle" data-act="pageDefault" data-l="${l}">${t('Start from the standard text')}</button></div>
      <textarea class="field page-ta" dir="${dir}" lang="${l}" data-page="${l}" placeholder="${t('Empty = the standard text is shown.')}">${esc(pg[l] || '')}</textarea>
      <div class="hint" style="margin-top:6px">${t('Preview')}:</div><div class="prose page-prev" dir="${dir}" id="prev-${l}">${PAGES.render(pg[l] || PAGES.defaults(l)[slug])}</div></div>`;
  return head(t('Pages'), t('Edit the policy pages customers see. Each language is separate; leave one empty to show the standard text.')) + `
    <div class="tabs2">${PAGES.slugs.map(k => `<button class="${slug === k ? 'on' : ''}" data-act="go" data-href="#/pages/${k}">${t(names[k])}</button>`).join('')}</div>
    <p class="hint" style="margin-bottom:14px">${t('Formatting: start a line with ## for a heading, - for a bullet, wrap words in **double stars** for bold. Write {delivery_fees} where the delivery price list should appear.')}</p>
    <div class="adm-grid g2">${box('en', 'ltr', t('ENGLISH'))}${box('ar', 'rtl', t('ARABIC'))}</div>
    <div class="save-bar"><button class="btn btn-gold" data-act="savePages">${t('SAVE PAGES')}</button><a class="btn btn-line" href="index.html?preview=1#/page/${slug}" target="_blank" rel="noopener">${t('VIEW ON SHOP')} ↗</a><span class="msg${A.ui.pOk ? '' : ' err'}">${esc(A.ui.pMsg || '')}</span></div>`;
}

// ───────────────────────── export to Excel ─────────────────────────
const toLocalInput = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
function exportPreset(k) {
  const now = new Date(), s0 = new Date(now); s0.setHours(0, 0, 0, 0);
  let from = s0, to = now;
  if (k === '7') { from = new Date(s0); from.setDate(from.getDate() - 6); }
  if (k === 'month') from = new Date(now.getFullYear(), now.getMonth(), 1);
  if (k === 'lastmonth') { from = new Date(now.getFullYear(), now.getMonth() - 1, 1); to = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, -1); }
  if (k === 'year') from = new Date(now.getFullYear(), 0, 1);
  if (k === 'all') from = new Date(2020, 0, 1);
  A.ui.exFrom = toLocalInput(from); A.ui.exTo = toLocalInput(to);
}
function viewExport() {
  if (!A.ui.exFrom) exportPreset('month');
  const sheets = A.ui.exSheets = A.ui.exSheets || { orders: true, items: true, customers: true, products: true, reviews: true };
  const labels = { orders: 'Orders', items: 'Order items', customers: 'Customers', products: 'Products & sales', reviews: 'Reviews' };
  const from = new Date(A.ui.exFrom), to = new Date(A.ui.exTo);
  const n = A.orders.filter(o => new Date(o.created_at) >= from && new Date(o.created_at) <= to).length;
  return head(t('Export'), t('Download your data as an Excel file for any period, to the minute.')) + `
    <div class="adm-card"><h3>${t('PERIOD')}</h3>
      <div class="actions" style="margin:12px 0 16px">${[['today', 'Today'], ['7', 'Last 7 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['year', 'This year'], ['all', 'All time']].map(([k, l]) => `<button class="btn btn-line btn-sm" data-act="exPreset" data-k="${k}">${t(l)}</button>`).join('')}</div>
      <div class="frm"><div><label>${t('From')}</label><input class="field" type="datetime-local" id="ex-from" value="${esc(A.ui.exFrom)}"></div>
        <div><label>${t('To')}</label><input class="field" type="datetime-local" id="ex-to" value="${esc(A.ui.exTo)}"></div></div>
      <h3 style="margin-top:22px">${t('INCLUDE')}</h3>
      <div class="checks" style="margin-top:10px">${Object.keys(labels).map(k => `<label><input type="checkbox" data-sheet="${k}"${sheets[k] ? ' checked' : ''}> ${t(labels[k])}</label>`).join('')}</div>
      <div class="actions" style="margin-top:22px"><button class="btn btn-gold" data-act="doExport"${A.ui.exBusy ? ' disabled' : ''}>${A.ui.exBusy ? t('PREPARING…') : t('DOWNLOAD EXCEL FILE')}</button>
        <span class="muted" style="align-self:center;font-size:13px">${n1(n, '{n} order in this period', '{n} orders in this period')}</span></div>
      <p class="hint" style="margin-top:12px">${t('Times are your computer’s local time. Customers and products are summarised for the chosen period.')}</p></div>`;
}
async function doExport() {
  if (!window.XLSX) return toast(t('The Excel tool didn’t load — please refresh the page.'));
  const from = new Date(A.ui.exFrom), to = new Date(A.ui.exTo);
  if (!(from <= to)) return toast(t('“From” must be before “To”.'));
  A.ui.exBusy = true; render();
  try {
    const all = await API.admin.orders(from.toISOString());
    const orders = all.filter(o => new Date(o.created_at) <= to);
    const S2 = A.ui.exSheets, wb = XLSX.utils.book_new();
    const add = (name, rows, widths) => { const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ [t('No data')]: '' }], { cellDates: true }); if (widths) ws['!cols'] = widths.map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31)); };
    const optStr = o => optText(o || {});
    if (S2.orders) add(t('Orders'), orders.map(o => ({
      [t('Order')]: o.order_no, [t('Date')]: new Date(o.created_at), [t('Status')]: t(STATUS_LBL[o.status] || o.status),
      [t('Customer')]: o.customer.name, [t('Phone')]: o.customer.phone, [t('Second phone')]: o.customer.phone2 || '', [t('Email')]: o.customer.email,
      [t('Account')]: o.user_id ? t('Yes') : t('Guest'), [t('Delivery')]: o.fulfil === 'pickup' ? t('Branch pickup') : t('Delivery'), [t('City')]: o.city || '', [t('Address')]: o.address,
      [t('Payment')]: t(PAY[o.payment]), [t('Payment status')]: t(PAY_ST[o.payment_status] || o.payment_status), [t('Pieces')]: (o.items || []).reduce((a, i) => a + i.qty, 0),
      [t('Subtotal')]: o.subtotal, [t('Discount')]: o.discount, [t('Discount code')]: o.promo_code || '', [t('Delivery fee')]: o.delivery_fee, [t('Total')]: o.total,
      [t('Refunded')]: o.refunded || 0, [t('Net')]: net(o), [t('Customer note')]: o.note, [t('Internal note')]: o.admin_note,
    })), [10, 18, 14, 22, 14, 14, 26, 9, 14, 14, 40, 18, 18, 8, 10, 10, 12, 12, 10, 10, 10, 30, 30]);
    if (S2.items) add(t('Order items'), orders.flatMap(o => (o.items || []).map(i => ({
      [t('Order')]: o.order_no, [t('Date')]: new Date(o.created_at), [t('Status')]: t(STATUS_LBL[o.status] || o.status), [t('Code')]: i.code, [t('Product')]: i.name,
      [t('Options')]: optStr(i.opts), [t('Qty')]: i.qty, [t('Unit price')]: i.unit, [t('Line total')]: i.unit * i.qty,
    }))), [10, 18, 14, 8, 30, 30, 6, 10, 10]);
    if (S2.customers) {
      const m = {};
      orders.forEach(o => { const k = o.user_id || 'p:' + o.customer.phone; const r = m[k] = m[k] || { name: o.customer.name, phone: o.customer.phone, email: o.customer.email, acc: !!o.user_id, n: 0, spent: 0, first: o.created_at, last: o.created_at };
        r.n++; if (o.status !== 'cancelled') r.spent += net(o); if (o.created_at < r.first) r.first = o.created_at; if (o.created_at > r.last) r.last = o.created_at; });
      add(t('Customers'), Object.values(m).sort((a, b) => b.spent - a.spent).map(r => ({ [t('Customer')]: r.name, [t('Phone')]: r.phone, [t('Email')]: r.email, [t('Account')]: r.acc ? t('Yes') : t('Guest'),
        [t('Orders')]: r.n, [t('Spent')]: r.spent, [t('First order')]: new Date(r.first), [t('Last order')]: new Date(r.last) })), [24, 14, 28, 9, 8, 12, 18, 18]);
    }
    if (S2.products) {
      const sold = {}; orders.filter(o => o.status !== 'cancelled').forEach(o => (o.items || []).forEach(i => { const r = sold[i.id] = sold[i.id] || { q: 0, rev: 0 }; r.q += i.qty; r.rev += i.qty * i.unit; }));
      add(t('Products & sales'), A.products.map(p => ({ [t('Code')]: p.code, [t('Product')]: p.name, [t('Arabic name')]: p.nameAr, [t('Category')]: p.cat, [t('Subcategory')]: p.sub,
        [t('Price')]: p.price, [t('Old price')]: p.oldPrice || '', [t('Stock')]: p.stock, [t('In the shop')]: p.active ? t('Yes') : t('No'),
        [t('Pieces sold')]: (sold[p.id] || {}).q || 0, [t('Sales')]: (sold[p.id] || {}).rev || 0 })), [8, 30, 26, 12, 14, 10, 10, 8, 10, 10, 12]);
    }
    if (S2.reviews) add(t('Reviews'), A.reviews.filter(r => new Date(r.created_at) >= from && new Date(r.created_at) <= to).map(r => ({
      [t('Date')]: new Date(r.created_at), [t('Name')]: r.name, [t('Rating')]: r.rating, [t('Review')]: r.text, [t('Published')]: r.approved ? t('Yes') : t('No') })), [18, 20, 8, 60, 10]);
    const stamp = d => toLocalInput(d).replace('T', '_').replace(':', '');
    XLSX.writeFile(wb, `ALLURE_${stamp(from)}_to_${stamp(to)}.xlsx`, { compression: true });
    API.admin.logEvent('export', `${stamp(from)} → ${stamp(to)}`, { sheets: wb.SheetNames });
    toast(t('Excel file downloaded'));
  } catch (e) { toast(API.errMessage(e)); }
  A.ui.exBusy = false; render();
}

// ───────────────────────── image cropping ─────────────────────────
// Resolves to a Blob (cropped), 'orig' (use the picture as it is) or null (cancelled).
function cropImage(src, { title, hint = '', ratios = [['3:4', 3 / 4]], maxSide = 1600 }) {
  return new Promise(resolve => {
    const m = $('#cropModal');
    m.innerHTML = `<div class="crop-box" role="dialog" aria-label="${esc(title)}"><div class="crop-head"><b>${esc(title)}</b>${hint ? `<span class="hint">${hint}</span>` : ''}</div>
      <div class="crop-stage"><img id="cropImg" alt=""></div>
      <div class="crop-tools">${ratios.map(([l, r], i) => `<button type="button" class="btn btn-line btn-sm${i === 0 ? ' on' : ''}" data-crop="ratio" data-r="${r}">${t(l)}</button>`).join('')}
        <button type="button" class="btn btn-line btn-sm" data-crop="rotate">⟳ ${t('Rotate')}</button><button type="button" class="btn btn-line btn-sm" data-crop="zin">＋</button><button type="button" class="btn btn-line btn-sm" data-crop="zout">－</button></div>
      <div class="actions crop-actions"><button type="button" class="btn btn-gold" data-crop="ok">${t('CROP & USE')}</button><button type="button" class="btn btn-line" data-crop="orig">${t('USE WITHOUT CROPPING')}</button><button type="button" class="btn btn-line" data-crop="cancel">${t('CANCEL')}</button></div></div>`;
    m.hidden = false;
    const img = $('#cropImg'); img.src = src;
    let cropper = null;
    img.onload = () => { cropper = new Cropper(img, { aspectRatio: ratios[0][1], viewMode: 1, autoCropArea: 1, background: false, responsive: true }); };
    const done = v => { if (cropper) cropper.destroy(); m.hidden = true; m.innerHTML = ''; m.onclick = null; resolve(v); };
    m.onclick = e => {
      const b = e.target.closest('[data-crop]'); if (!b) return;
      const a = b.dataset.crop;
      if (a === 'cancel') return done(null);
      if (a === 'orig') return done('orig');
      if (!cropper) return;
      if (a === 'rotate') cropper.rotate(90);
      if (a === 'zin') cropper.zoom(0.1);
      if (a === 'zout') cropper.zoom(-0.1);
      if (a === 'ratio') { cropper.setAspectRatio(+b.dataset.r || NaN); m.querySelectorAll('[data-crop=ratio]').forEach(x => x.classList.toggle('on', x === b)); }
      if (a === 'ok') cropper.getCroppedCanvas({ maxWidth: maxSide, maxHeight: maxSide, imageSmoothingQuality: 'high', fillColor: '#ffffff' })
        .toBlob(bl => done(bl), 'image/jpeg', 0.88);
    };
  });
}
const PRODUCT_CROP = () => ({ title: t('Crop product photo'), hint: t('Recommended: {size} (portrait 3:4).', { size: '1200 × 1600 px' }), ratios: [['3:4 (recommended)', 3 / 4], ['1:1', 1], ['Free', NaN]], maxSide: 1600 });
const BANNER_CROP = () => ({ title: t('Crop banner'), hint: t('Recommended: {size}.', { size: '2400 × 1100 px' }), ratios: [['Banner 24:11', 24 / 11], ['Free', NaN]], maxSide: 2400 });
const CAT_CROP = () => ({ title: t('Crop category picture'), hint: t('Recommended: {size} (portrait 3:4).', { size: '900 × 1200 px' }), ratios: [['3:4 (recommended)', 3 / 4], ['Free', NaN]], maxSide: 1400 });
const CHART_CROP = () => ({ title: t('Crop size chart'), hint: t('Keep the whole table readable.'), ratios: [['Free', NaN], ['1:1', 1]], maxSide: 2000 });
async function cropAndUpload(fileOrUrl, opts, folder) {
  let src, original = null;
  if (typeof fileOrUrl === 'string') {
    const res = await fetch(fileOrUrl); original = await res.blob(); src = URL.createObjectURL(original);
  } else { original = fileOrUrl; src = URL.createObjectURL(fileOrUrl); }
  const r = await cropImage(src, opts);
  URL.revokeObjectURL(src);
  if (r === null) return null;
  const file = r === 'orig' ? await shrink(original instanceof File ? original : new File([original], 'photo.jpg', { type: original.type || 'image/jpeg' }), opts.maxSide)
    : new File([r], 'photo.jpg', { type: 'image/jpeg' });
  return API.admin.uploadImage(file, folder);
}

// ───────────────────────── email setup (notifications page) ─────────────────────────
function emailCard() {
  const es = A.ui.es, em = A.settings.mailer || {};
  return `<div class="adm-card"><h3>${t('EMAIL — ORDER CONFIRMATIONS')}</h3><p class="note">${t('Every customer gets an email with their order number, items, total and payment steps. Sent with Resend (free).')}</p>
    <div class="kv" style="margin:6px 0 16px"><span class="k">${t('RESEND KEY')}</span><span>${es ? (es.key ? `<span class="ok">✓ ${t('Saved')}</span>` : `<span class="bad">${t('Not set')}</span>`) : '…'}</span>
      <span class="k">${t('SENDER')}</span><span>${esc((em.fromName || 'ALLURE Boutique') + ' <' + (em.fromEmail || 'onboarding@resend.dev') + '>')}</span></div>
    <form class="frm" data-form="testEmail" style="grid-template-columns:1fr auto;align-items:end"><div><label>${t('Send a test email to')}</label><input class="field" type="email" id="te-to" placeholder="you@gmail.com" value="${esc(A.ui.teTo || em.replyTo || '')}"></div>
      <button class="btn btn-gold" type="submit" style="height:48px"${es && es.key ? '' : ' disabled'}>${t('SEND TEST')}</button></form>
    ${A.ui.esMsg ? `<p class="note" style="margin-top:12px">${A.ui.esMsg}</p>` : ''}
    <h3 style="margin-top:22px">${t('ONE-TIME SETUP (≈ 10 MINUTES)')}</h3>
    <ol class="steps">
      <li>${t('Create a free account at {site}, then {path} and add {domain}.', { site: '<b>resend.com</b>', path: '<b>Domains → Add domain</b>', domain: '<b dir="ltr">allure-boutique.org</b>' })}</li>
      <li>${t('Resend shows 3 DNS records. Add each one in GoDaddy → DNS → Add New Record, then press Verify in Resend.')}</li>
      <li>${t('In Resend → API Keys → Create API key (permission: Sending access). Copy it.')}</li>
      <li>${t('In Supabase → {sql}, run (with your key):', { sql: '<b>SQL Editor</b>' })}<div class="code">select vault.create_secret('re_YOUR_KEY', 'resend_api_key');</div></li>
      <li>${t('In Settings → Emails to customers, set the sender address (e.g. orders@allure-boutique.org — no mailbox needed) and your Gmail as “Replies go to”.')}</li>
      <li>${t('Come back here and send a test email.')}</li>
    </ol></div>`;
}


// ───────────────────────── login / router ─────────────────────────
function viewLogin(denied) {
  const l = A.ui.login;
  return `<div class="login"><div class="box">
    <img class="logo-light" src="assets/logo-light.png" alt="ALLURE Boutique"><img class="logo-dark" src="assets/logo-dark.png" alt="ALLURE Boutique">
    <div class="eyebrow">${t('OWNER DASHBOARD')}</div>
    ${denied ? `<p class="page-sub" style="font-size:14px">${A.profile && A.profile.suspended ? t('Access for this account ({email}) is paused. Ask the main owner to turn it back on.', { email: esc(A.profile.email) }) : t('This account ({email}) is not an owner account.', { email: esc(A.profile && A.profile.email) })}</p>
      <button class="btn btn-line btn-block" style="margin-top:18px" data-act="signOut">${t('SIGN IN WITH ANOTHER ACCOUNT')}</button>
      <p class="note muted" style="font-size:12px;margin-top:16px">${t('Staff accounts are added by the main owner on the Team page.')}</p>`
    : `<form class="frm" data-form="login">
      <div><label for="lg-email">${t('Email')}</label><input id="lg-email" class="field" type="email" autocomplete="email" value="${esc(l.email)}" required></div>
      <div><label for="lg-pw">${t('Password')}</label><input id="lg-pw" class="field" type="password" autocomplete="current-password" required></div>
      ${l.msg ? `<div class="form-err">${esc(l.msg)}</div>` : ''}
      <button class="btn btn-gold btn-block" type="submit"${l.busy ? ' disabled' : ''}>${l.busy ? t('SIGNING IN…') : t('SIGN IN')}</button></form>`}
    <div class="login-lang">${langBtn()}</div>
  </div></div>`;
}
const noAccess = () => head(t('No access')) + `<div class="adm-card"><p class="note" style="margin:0">${t('Your account can’t open this page. Ask the main owner if you need it.')}</p></div>`;
function route() {
  const [a, b, c] = (location.hash.replace(/^#\/?/, '') || homePage()).split('/').map(decodeURIComponent);
  const page = a === 'order' ? 'orders' : a === 'customer' ? 'customers' : a;
  if (!navAllowed(page) || (a === 'overview' && !can('insights.view'))) return [page, noAccess()];
  switch (a) {
    case 'order': return ['orders', viewOrder(b)];
    case 'customer': return ['customers', viewCustomer(b, c)];
    case 'categories': return ['categories', viewCategories()];
    case 'activity': return ['activity', viewActivity()];
    case 'team': return ['team', viewTeam()];
    case 'me': return ['me', viewMe()];
    case 'insights': return ['insights', viewInsights()];
    case 'customers': return ['customers', viewCustomers(b)];
    case 'pages': return ['pages', viewPages(b)];
    case 'export': return ['export', viewExport()];
    case 'orders': return ['orders', viewOrders(b)];
    case 'products': return ['products', b ? viewProductEdit(b) : viewProducts()];
    case 'reviews': return ['reviews', viewReviews(b)];
    case 'settings': return ['settings', viewSettings()];
    case 'notifications': return ['notifications', viewNotifications()];
    case 'overview': return ['overview', viewOverview()];
    default: { const h = homePage(); return h === 'overview' ? ['overview', viewOverview()] : (location.replace('#/' + h), [h, '']); }
  }
}
let lastHash = null;
function render() {
  document.documentElement.setAttribute('data-theme', A.theme);
  const root = $('#root');
  if (A.phase === 'loading') { root.innerHTML = `<div class="login"><div class="muted">${t('Loading…')}</div></div>`; return; }
  if (A.phase === 'setup') { root.innerHTML = `<div class="login"><div class="box"><div class="eyebrow">${t('SETUP NEEDED')}</div><p class="page-sub">${t('Add your Supabase URL and anon key to config.js — see SETUP.md.')}</p></div></div>`; return; }
  if (A.phase === 'login' || A.phase === 'denied') { root.innerHTML = viewLogin(A.phase === 'denied'); return; }
  const focus = document.activeElement && document.activeElement.id;
  const caret = focus && document.activeElement.selectionStart;
  const y = window.scrollY, changed = location.hash !== lastHash;
  const [page, body] = route();
  root.innerHTML = shell(page, body);
  if (page === 'overview') drawChart();
  if (page === 'insights') drawInsightsChart();
  if (page === 'customers') { drawCustomerChart(); drawCustomerSpend(); }
  if (page === 'orders' && unseen()) markSeen();
  if (changed) { window.scrollTo(0, 0); lastHash = location.hash; } else {
    window.scrollTo(0, y);
    if (focus) { const el = document.getElementById(focus); if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch (e) {} } }
  }
}

// ───────────────────────── actions ─────────────────────────
const setDeep = (o, path, v) => { const k = path.split('.'); k.slice(0, -1).forEach(x => { o = o[x] = o[x] || {}; }); o[k[k.length - 1]] = v; };
const sMsg = (msg, ok) => { A.ui.sMsg = msg; A.ui.sOk = !!ok; };
const ACT = {
  go: el => { closeAll(); const h = el.dataset.href; if (h.startsWith('#/products/') && A.ui.edit && A.ui.edit._key !== decodeURIComponent(h.split('/')[2])) A.ui.edit = null; if (h === '#/products') A.ui.edit = null; if (location.hash === h) render(); else location.hash = h; },
  side: () => { A.ui.side = !A.ui.side; $('.adm-side').classList.toggle('open', A.ui.side); $('#scrim').classList.toggle('open', A.ui.side); },
  closeAll,
  theme: () => { A.theme = A.theme === 'dark' ? 'light' : 'dark'; store.set('theme', A.theme); render(); },
  lang: () => { I18N.set(isAr() ? 'en' : 'ar'); updateTitle(); render(); },
  signOut: async () => { await API.auth.signOut(); },
  range: el => { A.ui.range = +el.dataset.d; render(); },
  insRange: el => { A.ui.insDays = +el.dataset.d; render(); },
  insRefresh: () => { loadInsights(true); render(); },
  bannerRm: () => { A.settings.promo = { ...(A.settings.promo || {}), image: '' }; sMsg(t('Image removed — press Save settings to publish.'), true); render(); },
  chartTable: () => { A.ui.chartTable = !A.ui.chartTable; render(); },
  openOrder: el => { const h = location.hash; A.ui.backTo = h.startsWith('#/customer/') ? { no: el.dataset.no, href: h, label: A.ui.custName || t('Customer') } : null; openOrder(el.dataset.no); },
  setStatus: el => patchOrder({ status: el.dataset.s }, t('Order marked {s}', { s: t(STATUS_LBL[el.dataset.s]) })),
  cancelAsk: () => { A.ui.cancelConfirm = true; render(); },
  cancelNo: () => { A.ui.cancelConfirm = false; render(); },
  setPay: el => patchOrder({ payment_status: el.dataset.v }, el.dataset.v === 'confirmed' ? t('Payment marked as received') : t('Payment marked as not received')),
  saveNote: () => patchOrder({ admin_note: $('#adminNote').value }, t('Note saved')),
  // order management
  oform: el => { const o = A.orders.find(x => x.order_no === A.ui.open); if (!o) return; const f = el.dataset.f || null; if (f && A.ui.oform === f) A.ui.oform = null; else if (f) startOrderForm(o, f); else A.ui.oform = null; render(); },
  oeAdd: () => { const p = A.products.find(x => x.active && x.stock > 0) || A.products[0]; if (!p) return; A.ui.oedit.items.push({ id: p.id, qty: 1, unit: p.price, opts: {} }); render(); },
  oeRm: el => { A.ui.oedit.items.splice(+el.dataset.i, 1); render(); },
  doEdit: async () => {
    const o = A.orders.find(x => x.order_no === A.ui.open), d = A.ui.oedit, mode = A.ui.oform;
    if (!d.items.length) return toast(t('An order needs at least one piece.'));
    if (mode === 'exchange' && !d.note.trim()) return toast(t('Please describe the exchange.'));
    const payload = { mode, note: d.note, customer: d.customer, fulfil: d.fulfil, city: d.city, address: d.address,
      delivery_fee: Math.round(+d.delivery_fee || 0), discount: Math.round(+d.discount || 0), payment: d.payment, customer_note: d.customer_note,
      items: d.items.map(i => ({ id: i.id, qty: Math.max(1, Math.round(+i.qty || 1)), unit: Math.max(0, Math.round(+i.unit || 0)), opts: i.opts, name: i.name, code: i.code })) };
    try { const row = await API.admin.editOrder(o.id, payload); A.orders[A.orders.findIndex(x => x.id === o.id)] = row; A.ui.oform = null; A.products = await API.admin.products(); await loadCustomers();
      A.ui.eact = {}; toast(mode === 'exchange' ? t('Exchange saved') : t('Order updated')); render(); }
    catch (e) { toast(API.errMessage(e)); }
  },
  doRefund: async () => {
    const o = A.orders.find(x => x.order_no === A.ui.open);
    const amount = Math.round(+$('#rf-amount').value || 0), restock = $('#rf-restock').checked && !$('#rf-restock').disabled, note = $('#rf-note').value;
    try { const row = await API.admin.refundOrder(o.id, amount, restock, note); A.orders[A.orders.findIndex(x => x.id === o.id)] = row; A.ui.oform = null; A.products = await API.admin.products(); await loadCustomers();
      A.ui.eact = {}; toast(t('Return / refund recorded')); render(); }
    catch (e) { toast(API.errMessage(e)); }
  },
  doDelete: async () => {
    const o = A.orders.find(x => x.order_no === A.ui.open);
    const restock = $('#del-restock').checked && !$('#del-restock').disabled;
    try { await API.admin.deleteOrder(o.id, restock); A.orders = A.orders.filter(x => x.id !== o.id); A.products = await API.admin.products(); await loadCustomers();
      A.ui.eact = {}; toast(t('Order {no} deleted', { no: o.order_no })); location.hash = '#/orders'; render(); }
    catch (e) { toast(API.errMessage(e)); }
  },
  // customers
  openCust: el => openCustomer(el.dataset.k),
  // team
  permPreset: el => { const list = +el.dataset.i < 0 ? [] : [...PERM_PRESETS[+el.dataset.i][1]]; (el.dataset.scope === 'new' ? A.ui.newStaff : A.ui.staffEdit).perms = list; render(); },
  staffEdit: el => { const m = A.team.staff.find(x => x.id === el.dataset.id); A.ui.staffEdit = { id: m.id, perms: [...(m.perms || [])] }; render(); },
  staffEditNo: () => { A.ui.staffEdit = null; render(); },
  staffSave: async () => { const e = A.ui.staffEdit; try { await API.admin.updateStaff(e.id, { perms: e.perms }); A.ui.staffEdit = null; toast(t('Access saved')); loadTeam(); } catch (x) { toast(API.errMessage(x)); } },
  staffPause: async el => { try { await API.admin.updateStaff(el.dataset.id, { suspended: el.dataset.v === '1' }); toast(el.dataset.v === '1' ? t('Access paused') : t('Access resumed')); loadTeam(); } catch (x) { toast(API.errMessage(x)); } },
  staffRmAsk: el => { A.ui.staffRm = el.dataset.id; render(); },
  staffRmNo: () => { A.ui.staffRm = null; render(); },
  staffRemove: async el => { try { await API.admin.removeStaff(el.dataset.id); A.ui.staffRm = null; toast(t('Removed from the team')); loadTeam(); } catch (x) { toast(API.errMessage(x)); } },
  inviteCancel: async el => { try { await API.admin.cancelInvite(el.dataset.email); loadTeam(); } catch (x) { toast(API.errMessage(x)); } },
  // activity
  actFor: el => { A.ui.actF = { actor: el.dataset.id, area: '', days: 30 }; A.act = null; location.hash = '#/activity'; },
  actDays: el => { A.ui.actF.days = +el.dataset.d; A.act = null; render(); },
  actMore: () => loadActivity(true),
  // categories
  catAdd: () => { catDraft().push({ name: '', ar: '', bg: 'linear-gradient(150deg,#e0cd9e,#b18f48)', _from: null, _subs: [] }); render(); },
  catMove: el => { const a = catDraft(), i = +el.dataset.i, j = i + +el.dataset.d; [a[i], a[j]] = [a[j], a[i]]; render(); },
  catDelAsk: el => { A.ui.catDel = +el.dataset.i; render(); },
  catDelNo: () => { A.ui.catDel = null; render(); },
  catDel: el => {
    const a = catDraft(), i = +el.dataset.i, c = a[i], sel = $('#cat-move-to');
    if (c._from) A.ui.catGone.push({ from: c._from, to: sel ? a[+sel.value] : null });
    a.splice(i, 1); A.ui.catDel = null; render();
  },
  catImgRm: el => { delete catDraft()[+el.dataset.i].image; render(); },
  subAdd: el => { catDraft()[+el.dataset.i]._subs.push({ name: '', ar: '', _from: null }); render(); },
  subMove: el => { const l = catDraft()[+el.dataset.i]._subs, j = +el.dataset.j, k = j + +el.dataset.d; [l[j], l[k]] = [l[k], l[j]]; render(); },
  subDelAsk: el => { A.ui.subDel = el.dataset.i + ':' + el.dataset.j; render(); },
  subDelNo: () => { A.ui.subDel = null; render(); },
  subDel: el => {
    const c = catDraft()[+el.dataset.i], j = +el.dataset.j, x = c._subs[j], sel = $('#sub-move-to');
    const target = sel && sel.value ? c._subs.find(y => y.name === sel.value) : null;
    if (x._from) (c._subGone = c._subGone || []).push({ from: x._from, get to() { return target ? target.name.trim() : null; } });
    c._subs.splice(j, 1); A.ui.subDel = null; render();
  },
  catSave: () => saveCategories(),
  catReset: () => { A.ui.cats = null; render(); },
  linkGuest: async el => { try { const n = await API.admin.linkOrders(el.dataset.id, el.dataset.p); A.orders = await API.admin.orders(); await loadCustomers(); toast(n1(n, '{n} order added to the account', '{n} orders added to the account')); render(); } catch (e) { toast(API.errMessage(e)); } },
  addrNew: () => { A.ui.addr.form = { is_default: !A.ui.addr.list.length }; render(); },
  addrEdit: el => { A.ui.addr.form = { ...A.ui.addr.list.find(x => x.id === +el.dataset.id) }; render(); },
  addrCancel: () => { A.ui.addr.form = null; render(); },
  addrDefault: async el => { const x = A.ui.addr.list.find(y => y.id === +el.dataset.id); try { await API.saveAddress({ ...x, is_default: true }); await reloadAddr(); toast(t('Default address changed')); } catch (e) { toast(API.errMessage(e)); } },
  addrDelete: async el => { try { await API.deleteAddress(+el.dataset.id); await reloadAddr(); toast(t('Address deleted')); } catch (e) { toast(API.errMessage(e)); } },
  blockAcc: async el => { try { await API.admin.updateCustomer(el.dataset.id, { blocked: true, blocked_reason: ($('#cb-reason') || {}).value || '' }); await loadCustomers(); toast(t('Customer blocked')); render(); } catch (e) { toast(API.errMessage(e)); } },
  unblockAcc: async el => { try { await API.admin.updateCustomer(el.dataset.id, { blocked: false }); await loadCustomers(); toast(t('Customer unblocked')); render(); } catch (e) { toast(API.errMessage(e)); } },
  blockGuest: async el => { try { await API.admin.blockPhone(el.dataset.id, true, ($('#cb-reason') || {}).value || ''); await loadCustomers(); toast(t('Phone number blocked')); render(); } catch (e) { toast(API.errMessage(e)); } },
  unblockPhone: async el => { try { await API.admin.blockPhone(el.dataset.p, false); await loadCustomers(); toast(t('Phone number unblocked')); render(); } catch (e) { toast(API.errMessage(e)); } },
  // pages
  pageDefault: el => { const l = el.dataset.l, slug = A.ui.pslug; A.settings.pages[slug][l] = PAGES.defaults(l)[slug]; render(); },
  savePages: async () => { try { await API.admin.saveSettings(A.settings); A.ui.pMsg = t('Saved — the pages are updated.'); A.ui.pOk = true; } catch (e) { A.ui.pMsg = API.errMessage(e); A.ui.pOk = false; } render(); },
  // export
  exPreset: el => { exportPreset(el.dataset.k); render(); },
  doExport,
  // product editor
  imgCrop: async el => { const ed = A.ui.edit, i = +el.dataset.i; try { const url = await cropAndUpload(ed.images[i], PRODUCT_CROP(), ed._new ? slug(ed.name || 'new') : ed.id); if (url) { ed.images[i] = url; render(); } } catch (e) { toast(t('Upload failed: {msg}', { msg: API.errMessage(e) })); } },
  chartRm: () => { A.ui.edit.sizeChart = ''; render(); },
  addColor: () => { A.ui.edit._colors.push({ name: '', ar: '', hex: '#d4a62a' }); render(); },
  rmColor: el => { A.ui.edit._colors.splice(+el.dataset.i, 1); render(); },
  addPart: () => { A.ui.edit._parts.push({ name: '', ar: '', price: '' }); render(); },
  rmPart: el => { A.ui.edit._parts.splice(+el.dataset.i, 1); render(); },
  imgMove: el => { const a = A.ui.edit.images, i = +el.dataset.i, j = i + +el.dataset.d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; render(); },
  imgRm: el => { A.ui.edit.images.splice(+el.dataset.i, 1); render(); },
  // reviews
  revApprove: async el => { try { await API.admin.setReviewApproved(+el.dataset.id, el.dataset.v === '1'); A.reviews.find(r => r.id === +el.dataset.id).approved = el.dataset.v === '1'; toast(el.dataset.v === '1' ? t('Review published') : t('Review hidden')); render(); } catch (e) { toast(API.errMessage(e)); } },
  revDeleteAsk: el => { A.ui.delConfirm = +el.dataset.id; render(); },
  revDelete: async el => { try { await API.admin.deleteReview(+el.dataset.id); A.reviews = A.reviews.filter(r => r.id !== +el.dataset.id); A.ui.delConfirm = null; toast(t('Review deleted')); render(); } catch (e) { toast(API.errMessage(e)); } },
  // settings
  addCity: () => { A.settings.delivery.push({ city: '', fee: 0, ar: '' }); render(); },
  rmCity: el => { A.settings.delivery.splice(+el.dataset.i, 1); render(); },
  promoToggle: async el => { const p = A.promos.find(x => x.code === el.dataset.code); try { await API.admin.savePromo({ ...p, active: !p.active }); p.active = !p.active; render(); } catch (e) { toast(API.errMessage(e)); } },
  promoDelete: async el => { try { await API.admin.deletePromo(el.dataset.code); A.promos = A.promos.filter(x => x.code !== el.dataset.code); render(); } catch (e) { toast(API.errMessage(e)); } },
  // notifications
  tgConnect: async () => {
    try {
      const r = await API.admin.tgConnect();
      A.ui.tgc = { code: r.code, bot: r.bot, req: null, msg: '', started: Date.now() }; A.ui.tgMsg = ''; render();
      if (!r.bot && r.req) setTimeout(async () => { try { A.ui.tgc.bot = await API.admin.tgBot(r.req); if (!A.ui.tgc.bot) A.ui.tgc.msg = `<span class="bad">${t('Telegram didn’t answer — check the bot token.')}</span>`; } catch (e) {} render(); }, 1800);
      tgPoll();
    } catch (e) { A.ui.tgMsg = `<span class="bad">${esc(API.errMessage(e))}</span>`; render(); }
  },
  tgStop: () => { A.ui.tgc = null; render(); },
  tgRemove: async el => { try { await API.admin.tgRemove(el.dataset.chat); A.ui.tg = await API.admin.telegramStatus(); toast(t('Chat disconnected')); render(); } catch (e) { toast(API.errMessage(e)); } },
  tgRefresh: async () => { try { A.ui.tg = await API.admin.telegramStatus(); A.ui.tgMsg = ''; } catch (e) { A.ui.tgMsg = esc(API.errMessage(e)); } render(); },
  tgTest: async () => {
    try {
      const id = await API.admin.testTelegram();
      if (!id) { A.ui.tgMsg = `<span class="bad">${t('Token or chat ID missing.')}</span>`; return render(); }
      A.ui.tgMsg = t('Sending…'); render();
      setTimeout(async () => {
        try {
          const r = await API.admin.httpResult(id);
          if (!r) A.ui.tgMsg = t('Sent — check Telegram. (No reply recorded yet.)');
          else if (r.status_code === 200) A.ui.tgMsg = `<span class="ok">✓ ${t('Delivered — check your Telegram.')}</span>`;
          else { let d = ''; try { d = JSON.parse(r.content).description; } catch (e) { d = r.error || r.content; } A.ui.tgMsg = `<span class="bad">${t('Telegram said: {msg}', { msg: esc(d || 'error ' + r.status_code) })}</span> — ${t('check the token and chat ID, and that you pressed Start in the bot.')}`; }
        } catch (e) { A.ui.tgMsg = t('Sent — check Telegram.'); }
        render();
      }, 2500);
    } catch (e) { A.ui.tgMsg = `<span class="bad">${esc(API.errMessage(e))}</span>`; render(); }
  },
  notifAsk: async () => { try { await Notification.requestPermission(); } catch (e) {} render(); },
  soundToggle: () => { A.prefs.sound = !A.prefs.sound; store.set('admin.prefs', A.prefs); render(); },
  alertTest: () => { chime(); desktopAlert({ order_no: 'TEST', total: 1234, customer: { name: t('Test customer') }, payment: 'instapay', items: [{ qty: 1 }] }); toast(t('This is how a new order alert looks and sounds.')); },
};

async function reloadAddr() { const st = A.ui.addr; st.list = await API.addresses(st.user); st.form = null; render(); }
// asks the database every 3 s whether the bot has seen the person's "Start" (for up to 3 minutes)
function tgPoll() {
  const c = A.ui.tgc; if (!c || !c.code) return;
  if (Date.now() - c.started > 180000) { c.msg = `<span class="bad">${t('Nothing arrived yet. Press Start in the bot, then try again.')}</span>`; c.code = null; A.ui.tgc = null; A.ui.tgMsg = c.msg; return render(); }
  setTimeout(async () => {
    if (A.ui.tgc !== c) return;
    try {
      const r = await API.admin.tgCheck(c.code, c.req);
      if (r && r.linked) { A.ui.tgc = null; A.ui.tg = await API.admin.telegramStatus(); A.ui.tgMsg = `<span class="ok">✓ ${t('Connected: {name}. You’ll get a message there for every new order.', { name: esc(r.title || 'Telegram') })}</span>`; return render(); }
      if (r && r.error === 'webhook') { c.msg = `<span class="bad">${t('This bot is connected to another service (webhook). Remove it in that service, then try again.')}</span>`; render(); return; }
      if (r && r.expired) { A.ui.tgc = null; render(); return; }
      c.req = r && r.req;
    } catch (e) { c.msg = `<span class="bad">${esc(API.errMessage(e))}</span>`; render(); }
    tgPoll();
  }, 3000);
}
const FORMS = {
  staffAdd: async () => {
    const ns = A.ui.newStaff; ns.name = $('#ns-name').value.trim(); ns.email = $('#ns-email').value.trim().toLowerCase(); const pw = $('#ns-pw').value;
    if (!ns.name) { A.ui.staffMsg = `<span class="bad">${t('Please enter a name.')}</span>`; return render(); }
    if (!/^\S+@\S+\.\S+$/.test(ns.email)) { A.ui.staffMsg = `<span class="bad">${t('Please enter a valid email.')}</span>`; return render(); }
    if (!ns.perms.length) { A.ui.staffMsg = `<span class="bad">${t('Tick at least one thing they can do.')}</span>`; return render(); }
    A.ui.staffBusy = true; A.ui.staffMsg = ''; render();
    try {
      const r = await API.admin.inviteStaff(ns.email, ns.name, ns.perms);
      if (r === 'promoted') A.ui.staffMsg = `<span class="ok">✓ ${t('{name} already had an account — it is now a team account. They sign in with their own password.', { name: esc(ns.name) })}</span>`;
      else {
        if (pw.length < 6) { A.ui.staffBusy = false; A.ui.staffMsg = `<span class="bad">${t('Choose a temporary password (6+ characters).')}</span>`; return render(); }
        const c = await API.admin.createLogin(ns.email, pw, ns.name);
        A.ui.staffMsg = `<span class="ok">✓ ${c.confirm ? t('Login created. {name} gets an email to confirm the address, then signs in at {url} with the password you chose.', { name: esc(ns.name), url: `<b dir="ltr">${esc(location.origin + location.pathname)}</b>` })
          : t('Login created. {name} can sign in now at {url} with the password you chose.', { name: esc(ns.name), url: `<b dir="ltr">${esc(location.origin + location.pathname)}</b>` })}</span>`;
      }
      A.ui.newStaff = null; loadTeam();
    } catch (e) { A.ui.staffMsg = `<span class="bad">${esc(API.errMessage(e))}</span>`; }
    A.ui.staffBusy = false; render();
  },
  meSave: async () => {
    const name = $('#me-name').value.trim(); if (!name) return toast(t('Please enter your name.'));
    try { A.profile = { ...A.profile, ...(await API.updateProfile(A.profile.id, { name, phone: A.profile.phone })) }; toast(t('Saved')); render(); } catch (e) { toast(API.errMessage(e)); }
  },
  mePw: async () => {
    const a = $('#me-pw').value, b = $('#me-pw2').value;
    if (a.length < 6) return toast(t('Your password needs at least 6 characters.'));
    if (a !== b) return toast(t('The two passwords are different.'));
    try { await API.auth.updatePassword(a); $('#me-pw').value = $('#me-pw2').value = ''; toast(t('Password updated')); } catch (e) { toast(API.errMessage(e)); }
  },
  custEdit: async () => {
    const id = A.ui.cust.slice(2);
    try { await API.admin.updateCustomer(id, { name: $('#ce-name').value, phone: $('#ce-phone').value, staff_note: $('#ce-note').value }); await loadCustomers(); A.ui.eact = {}; toast(t('Customer saved')); render(); }
    catch (e) { toast(API.errMessage(e)); }
  },
  guestEdit: async () => {
    const ph = A.ui.cust.slice(2), np = $('#ge-phone').value.replace(/\s/g, '');
    try { await API.admin.updateGuest(ph, { name: $('#ge-name').value, email: $('#ge-email').value, phone: np }); A.orders = await API.admin.orders(); await loadCustomers();
      toast(t('Customer saved')); if (np !== ph) location.hash = '#/customer/' + encodeURIComponent('p:' + np) + '/details'; else render(); }
    catch (e) { toast(API.errMessage(e)); }
  },
  addrSave: async () => {
    const f = A.ui.addr.form;
    if (!f.city || !(f.region || '').trim() || !(f.street || '').trim() || !(f.building || '').trim()) return toast(t('Please fill in the city, area, street and building.'));
    try { await API.saveAddress({ ...f, user_id: A.ui.addr.user }); await reloadAddr(); toast(t('Address saved')); } catch (e) { toast(API.errMessage(e)); }
  },
  blockPhone: async () => {
    const ph = $('#bp-phone').value.replace(/\s/g, '');
    if (!/^01[0125]\d{8}$/.test(ph)) return toast(t('Please enter a valid mobile number.'));
    try { await API.admin.blockPhone(ph, true, $('#bp-reason').value); await loadCustomers(); toast(t('Phone number blocked')); render(); } catch (e) { toast(API.errMessage(e)); }
  },
  testEmail: async () => {
    const to = $('#te-to').value.trim(); A.ui.teTo = to;
    if (!/^\S+@\S+\.\S+$/.test(to)) return toast(t('Please enter a valid email.'));
    try {
      const id = await API.admin.testEmail(to);
      if (!id) { A.ui.esMsg = `<span class="bad">${t('Resend key missing.')}</span>`; return render(); }
      A.ui.esMsg = t('Sending…'); render();
      setTimeout(async () => {
        try { const r = await API.admin.httpResult(id);
          if (r && r.status_code === 200) A.ui.esMsg = `<span class="ok">✓ ${t('Sent — check the inbox (and spam folder) of {to}.', { to: esc(to) })}</span>`;
          else if (r) { let d = ''; try { d = JSON.parse(r.content).message; } catch (e) { d = r.error || r.content; } A.ui.esMsg = `<span class="bad">${t('Resend said: {msg}', { msg: esc(d || 'error ' + r.status_code) })}</span>`; }
          else A.ui.esMsg = t('Sent — check the inbox (and spam folder) of {to}.', { to: esc(to) });
        } catch (e) { A.ui.esMsg = t('Sent — check the inbox (and spam folder) of {to}.', { to: esc(to) }); }
        render();
      }, 3000);
    } catch (e) { A.ui.esMsg = `<span class="bad">${esc(API.errMessage(e))}</span>`; render(); }
  },
  login: async () => {
    const l = A.ui.login; l.email = $('#lg-email').value.trim(); const pw = $('#lg-pw').value;
    l.busy = true; l.msg = ''; render();
    try { await API.auth.signIn(l.email, pw); } catch (e) { l.msg = API.errMessage(e); }
    l.busy = false; if (A.phase === 'login') render();
  },
  product: async () => {
    const p = collectProduct(), e = A.ui.edit;
    const err = !p.name.trim() ? t('Please enter a name.') : !String(p.code).trim() ? t('Please enter a code.') : !(p.price >= 0) || p.price === '' ? t('Please enter a price.')
      : !(p.stock >= 0) ? t('Please enter the stock.') : (p.oldPrice && p.oldPrice <= p.price) ? t('Old price should be higher than the price.') : '';
    if (err) { A.ui.editMsg = err; A.ui.editOk = false; return render(); }
    A.ui.saving = true; A.ui.editMsg = ''; render();
    try {
      const saved = await API.admin.saveProduct(p, e._new);
      const i = A.products.findIndex(x => x.id === saved.id);
      if (i >= 0) A.products[i] = saved; else A.products.unshift(saved);
      A.ui.saving = false; A.ui.edit = null; toast(e._new ? t('Product added') : t('Product saved'));
      location.hash = '#/products/' + encodeURIComponent(saved.id);
      if (!e._new) render();
    } catch (x) {
      A.ui.saving = false; A.ui.editOk = false;
      A.ui.editMsg = /duplicate key.*code/i.test(x.message) ? t('Another product already uses this code.') : /duplicate key/i.test(x.message) ? t('A product with this name and code already exists.') : API.errMessage(x);
      render();
    }
  },
  settings: async () => {
    const d = A.settings.delivery || [], names = d.map(x => x.city.trim());
    if (names.some(n => !n)) { sMsg(t('Every delivery row needs a city name (or remove the row).')); return render(); }
    if (new Set(names).size !== names.length) { sMsg(t('Each city can only appear once in delivery fees.')); return render(); }
    d.forEach(x => { x.city = x.city.trim(); x.ar = (x.ar || '').trim(); });
    try { await API.admin.saveSettings(A.settings); sMsg(t('Saved — the shop is updated.'), true); }
    catch (e) { sMsg(API.errMessage(e)); }
    render();
  },
  promo: async () => {
    const code = $('#np-code').value.trim().toUpperCase().replace(/\s+/g, ''), pc = Math.round(+$('#np-pct').value), exp = $('#np-exp').value;
    if (!/^[A-Z0-9_-]{3,20}$/.test(code)) return toast(t('Codes use 3–20 letters or numbers.'));
    if (!(pc >= 1 && pc <= 90)) return toast(t('Discount must be between 1% and 90%.'));
    try {
      await API.admin.savePromo({ code, percent: pc, active: true, expires_at: exp ? new Date(exp + 'T23:59:59').toISOString() : null });
      A.promos = await API.admin.promos(); A.ui.newPromo = { code: '', percent: 10, expires: '' }; toast(t('Code {code} added', { code })); render();
    } catch (e) { toast(API.errMessage(e)); }
  },
};

document.addEventListener('click', e => {
  if (e.target.closest('a[href]') && (!e.target.closest('[data-act]') || e.metaKey || e.ctrlKey || e.shiftKey)) return;   // ctrl/⌘-click opens a new tab
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act]; if (fn) { e.preventDefault(); fn(el); }
});
document.addEventListener('submit', e => { const f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault(); FORMS[f.dataset.form] && FORMS[f.dataset.form](); });
document.addEventListener('input', e => {
  const el = e.target, ed = A.ui.edit, ds = el.dataset;
  if (el.id === 'oq') { A.ui.oq = el.value; render(); return; }
  if (el.id === 'pq') { A.ui.pq = el.value; render(); return; }
  if (el.id === 'pcat') { A.ui.pcat = el.value; render(); return; }
  if (el.id === 'cq') { A.ui.cq = el.value; render(); return; }
  if (ds.page) { const pg = A.settings.pages[A.ui.pslug]; pg[ds.page] = el.value; const pv = document.getElementById('prev-' + ds.page); if (pv) pv.innerHTML = PAGES.render(el.value || PAGES.defaults(ds.page)[A.ui.pslug]); return; }
  if (el.id === 'ex-from') { A.ui.exFrom = el.value; return; }
  if (el.id === 'ex-to') { A.ui.exTo = el.value; return; }
  if (ds.sheet) { A.ui.exSheets[ds.sheet] = el.checked; return; }
  if (ds.perm) { const tgt = ds.scope === 'new' ? A.ui.newStaff : A.ui.staffEdit; const set = new Set(tgt.perms); el.checked ? set.add(ds.perm) : set.delete(ds.perm); tgt.perms = [...set]; return; }
  if (el.id === 'af-actor') { A.ui.actF.actor = el.value; A.act = null; render(); return; }
  if (el.id === 'af-area') { A.ui.actF.area = el.value; render(); return; }
  if (el.id === 'ns-name' || el.id === 'ns-email') { A.ui.newStaff[el.id === 'ns-name' ? 'name' : 'email'] = el.value; return; }
  if (ds.af && A.ui.addr && A.ui.addr.form) { A.ui.addr.form[ds.af] = el.type === 'checkbox' ? el.checked : el.value; return; }
  if (A.ui.oedit && (ds.oe || ds.oi != null || ds.op != null)) {
    const d = A.ui.oedit;
    if (ds.oe) { const [a, b] = ds.oe.split('.'); if (b) d[a][b] = el.value; else d[a] = el.value; }
    // switching to pickup or changing the city refills the delivery fee (it can still be typed over)
    if (ds.oe === 'fulfil' || ds.oe === 'city') {
      const c = (A.settings.delivery || []).find(x => x.city === d.city);
      d.delivery_fee = d.fulfil === 'pickup' ? 0 : c ? c.fee : d.delivery_fee;
      const f = document.querySelector('[data-oe="delivery_fee"]'); if (f) f.value = d.delivery_fee;
    }
    if (ds.oi != null) {
      const it = d.items[+ds.oi];
      if (ds.k === 'id') { const p = A.products.find(x => x.id === el.value); Object.assign(it, { id: el.value, unit: p ? p.price : it.unit, opts: {}, name: p && p.name, code: p && p.code }); render(); return; }
      if (ds.k === 'qty' || ds.k === 'unit') it[ds.k] = el.value; else { if (el.value) it.opts[ds.k] = el.value; else delete it.opts[ds.k]; }
    }
    if (ds.op != null) { const it = d.items[+ds.op]; const parts = new Set(it.opts.parts || []); el.checked ? parts.add(el.value) : parts.delete(el.value); it.opts.parts = [...parts]; if (!it.opts.parts.length) delete it.opts.parts; }
    const sub = d.items.reduce((a, i) => a + (+i.unit || 0) * (+i.qty || 0), 0), tot = $('#oeTotal');
    if (tot) tot.textContent = money(Math.max(0, sub - (+d.discount || 0) + (+d.delivery_fee || 0)));
    return;
  }
  if (ed && ds.pe) { ed[ds.pe] = el.type === 'checkbox' ? el.checked : el.value; if (ds.pe === 'cat') { ed.sub = ''; const c = (A.settings.categories || []).find(x => x.name === el.value); if (c && c.bg && ed._new) ed.bg = c.bg; } if (ds.rerender) render(); return; }
  if (ed && ds.flag) { ed.flags = { ...ed.flags, [ds.flag]: el.checked }; return; }
  if (ed && ds.color != null) { ed._colors[+ds.color][ds.k] = el.value; return; }
  if (ed && ds.part != null) { ed._parts[+ds.part][ds.k] = el.value; return; }
  if (ds.set) { setDeep(A.settings, ds.set, el.type === 'checkbox' ? el.checked : el.value); return; }
  if (ds.deliv != null) {
    const d = A.settings.delivery[+ds.deliv];
    if (ds.k === 'fee') d.fee = Math.max(0, Math.round(+el.value || 0)); else d[ds.k] = el.value;
    return;
  }
  // categories editor (save button state is refreshed without redrawing the field being typed in)
  if (ds.cat != null) { A.ui.cats[+ds.cat][ds.k] = el.value; catDirty(); return; }
  if (ds.sub != null) { const [i, j] = ds.sub.split(':').map(Number); A.ui.cats[i]._subs[j][ds.k] = el.value; catDirty(); return; }
  if (ds.catcol != null) { const c = A.ui.cats[+ds.catcol], g = gradColors(c.bg); g[+ds.n] = el.value; c.bg = `linear-gradient(150deg,${g[0]},${g[1]})`; render(); return; }
  if (el.id === 'np-code' || el.id === 'np-pct' || el.id === 'np-exp') { A.ui.newPromo[{ 'np-code': 'code', 'np-pct': 'percent', 'np-exp': 'expires' }[el.id]] = el.value; }
});
function catDirty() { const b = document.querySelector('[data-act="catSave"]'); if (b) b.disabled = false; }
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.catimg != null && el.files.length) {
    const c = A.ui.cats[+el.dataset.catimg], f = el.files[0]; el.value = '';
    try { const url = await cropAndUpload(f, CAT_CROP(), 'categories'); if (url) { c.image = url; render(); } }
    catch (x) { toast(t('Upload failed: {msg}', { msg: API.errMessage(x) })); }
    return;
  }
  if (el.id === 'banner-file' && el.files.length) {
    const f = el.files[0]; el.value = '';
    try {
      A.ui.bannerUp = true; render();
      const url = await cropAndUpload(f, BANNER_CROP(), 'banners');
      if (url) { A.settings.promo = { ...(A.settings.promo || {}), image: url }; sMsg(t('Image uploaded — press Save settings to publish it.'), true); }
    } catch (x) { sMsg(t('Upload failed: {msg}', { msg: API.errMessage(x) })); }
    A.ui.bannerUp = false; render(); return;
  }
  if (el.id === 'pe-chart' && el.files.length) {
    const ed = A.ui.edit, f = el.files[0]; el.value = '';
    try { A.ui.chartUp = true; render(); const url = await cropAndUpload(f, CHART_CROP(), (ed._new ? slug(ed.name || 'new') : ed.id) + '/size-chart'); if (url) ed.sizeChart = url; }
    catch (x) { toast(t('Upload failed: {msg}', { msg: API.errMessage(x) })); }
    A.ui.chartUp = false; render(); return;
  }
  if (el.id === 'pe-files' && el.files.length) {
    const ed = A.ui.edit; const files = [...el.files];
    const pid = ed._new ? slug(ed.name || 'new') + '-' + slug(ed.code || Date.now()) : ed.id;
    A.ui.uploading = true; render();
    el.value = '';
    for (const f of files) {
      try { const url = await cropAndUpload(f, PRODUCT_CROP(), pid); if (url) { ed.images.push(url); render(); } }
      catch (x) { toast(t('Upload failed: {msg}', { msg: API.errMessage(x) })); }
    }
    A.ui.uploading = false; render();
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
window.addEventListener('hashchange', () => { if (A.phase === 'app') render(); });
let rT; window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { if (A.phase === 'app' && $('#revChart')) drawChart(); if (A.phase === 'app' && $('#insChart')) drawInsightsChart(); if (A.phase === 'app' && $('#custChart')) drawCustomerChart(); }, 150); });

// ───────────────────────── boot ─────────────────────────
let channel = null, presence = null;
async function onSession(session) {
  if (!session) {
    A.phase = 'login'; A.profile = null;
    if (channel) { API.sb.removeChannel(channel); channel = null; }
    if (presence) { API.sb.removeChannel(presence); presence = null; }
    return render();
  }
  try { A.profile = await API.profile(); } catch (e) { A.profile = null; }
  if (!A.profile || !['owner', 'admin'].includes(A.profile.role) || A.profile.suspended) { A.phase = 'denied'; A.profile = A.profile || { email: session.user.email }; return render(); }
  try { if (!sessionStorage.getItem('au.signed.' + A.profile.id)) { sessionStorage.setItem('au.signed.' + A.profile.id, '1'); API.admin.logEvent('sign_in', DEVICE_NAME()); } } catch (e) {}
  try { await loadAll(); } catch (e) { A.ui.login.msg = API.errMessage(e); A.phase = 'login'; return render(); }
  if (A.seen == null) markSeen();
  A.phase = 'app';
  if (!channel && can('orders.view')) channel = API.subscribeOrders('admin-orders', onOrderChange);
  if (!presence) {
    presence = API.presence('owner-' + A.profile.id);
    let pT = null;
    presence.on('presence', { event: 'sync' }, () => {
      A.live = summarizePresence(presence.presenceState());
      clearTimeout(pT); pT = setTimeout(() => { if (A.phase === 'app' && !$('input:focus, textarea:focus, select:focus')) render(); }, 400);
    }).subscribe();
  }
  API.admin.telegramStatus().then(s => { A.ui.tg = s; if (/notifications/.test(location.hash)) render(); }).catch(() => {});
  API.admin.emailStatus().then(s => { A.ui.es = s; if (/notifications/.test(location.hash)) render(); }).catch(() => {});
  updateTitle(); render();
}
function boot() {
  updateTitle();
  if (!API.ready) { A.phase = 'setup'; return render(); }
  render();
  API.auth.onChange((event, session) => {
    if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT'].includes(event)) setTimeout(() => onSession(session), 0);
  });
}
boot();
})();
