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

const STATUS = ['pending', 'shipped', 'received', 'cancelled'];
const STATUS_LBL = { cart: 'My Cart', pending: 'Pending', shipped: 'Shipped', received: 'Received', cancelled: 'Cancelled' };
const PAY = { cod: 'Cash on delivery', instapay: 'InstaPay / VC' };
const PAY_ST = { awaiting: 'Awaiting payment', confirmed: 'Paid', not_required: 'Pay at pickup' };
const prodName = (id, fallback) => { const p = A.products.find(x => x.id === id); return p ? I18N.pick(p.name, p.nameAr) : fallback; };
const optText = (o = {}) => [o.color && I18N.opt(o.color), o.letter && t('Letter {v}', { v: o.letter }), o.ringSize && t('Size {v}', { v: o.ringSize }), o.bagSize,
  o.parts && o.parts.length && o.parts.map(I18N.opt).join(' + ')].filter(Boolean).join(' · ');
const catLabel = name => { const c = (A.settings.categories || []).find(x => x.name === name); return c ? I18N.pick(c.name, c.ar) : name; };
const subLabel = (cat, sub) => { const c = (A.settings.categories || []).find(x => x.name === cat); return I18N.pick(sub, c && c.subs_ar && c.subs_ar[sub]); };
const cityLabel = city => { const d = (A.settings.delivery || []).find(x => x.city === city); return d ? I18N.pick(d.city, d.ar) : city; };

let toastT;
function toast(msg) { const el = $('#toast'); el.innerHTML = `<span>${esc(msg)}</span>`; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3200); }

// ───────────────────────── loading ─────────────────────────
async function loadAll() {
  const [orders, products, reviews, settings, promos] = await Promise.all([
    API.admin.orders(), API.admin.products(), API.admin.reviews(), API.admin.settings(), API.admin.promos(),
  ]);
  Object.assign(A, { orders, products, reviews, settings, promos });
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
    n.onclick = () => { window.focus(); location.hash = '#/orders'; openOrder(o.order_no); n.close(); };
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
  updateTitle(); render(); if (A.ui.open) renderDrawer();
}

// ───────────────────────── shell ─────────────────────────
const NAV = [['overview', 'OVERVIEW'], ['insights', 'INSIGHTS'], ['orders', 'ORDERS'], ['products', 'PRODUCTS'], ['reviews', 'REVIEWS'], ['settings', 'SETTINGS'], ['notifications', 'NOTIFICATIONS']];
const langBtn = () => `<button data-act="lang" lang="${isAr() ? 'en' : 'ar'}">${isAr() ? 'ENGLISH' : 'عربي'}</button>`;
function shell(page, body) {
  const counts = { orders: unseen(), reviews: pendingReviews(), insights: A.live.online };
  return `<div class="adm">
    <aside class="adm-side${A.ui.side ? ' open' : ''}">
      <div class="brand"><img class="logo-light" src="assets/logo-light.png" alt="ALLURE Boutique"><img class="logo-dark" src="assets/logo-dark.png" alt="ALLURE Boutique"><span>${t('OWNER DASHBOARD')}</span></div>
      <nav class="adm-nav">${NAV.map(([k, l]) => `<button class="${page === k ? 'on' : ''}" data-act="go" data-href="#/${k}">${t(l)}${counts[k] ? `<span class="cnt${k === 'insights' ? ' live' : ''}">${k === 'insights' ? '● ' : ''}${counts[k]}</span>` : ''}</button>`).join('')}</nav>
      <div class="foot">
        <a href="index.html?preview=1" target="_blank" rel="noopener">${t('VIEW SHOP')} ↗</a>
        ${langBtn()}
        <button data-act="theme">${A.theme === 'dark' ? '☀ ' + t('IVORY MODE') : '☾ ' + t('NOIR MODE')}</button>
        <button data-act="signOut">${t('SIGN OUT')} · ${esc((A.profile.name || A.profile.email).split(' ')[0])}</button>
      </div>
    </aside>
    <div style="min-width:0">
      <div class="adm-top"><button class="icon-btn" data-act="side" aria-label="${t('Menu')}">☰</button>
        <img class="logo-light" src="assets/logo-light.png" alt="ALLURE"><img class="logo-dark" src="assets/logo-dark.png" alt="ALLURE">
        <button class="icon-btn" data-act="go" data-href="#/orders" aria-label="${t('Orders')}" style="font-size:12px">${counts.orders ? `<span class="pill2 awaiting">${t('{n} NEW', { n: counts.orders })}</span>` : t('ORDERS')}</button></div>
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
  const revenue = live.reduce((a, o) => a + o.total, 0);
  const today = dayKey(new Date());
  const todayRev = A.orders.filter(o => o.status !== 'cancelled' && dayKey(o.created_at) === today).reduce((a, o) => a + o.total, 0);
  const awaiting = A.orders.filter(o => o.payment_status === 'awaiting' && o.status !== 'cancelled').length;
  const toShip = A.orders.filter(o => o.status === 'pending').length;

  // previous period, for the delta
  const prevFrom = new Date(from); prevFrom.setDate(prevFrom.getDate() - days);
  const prevRev = A.orders.filter(o => o.status !== 'cancelled' && new Date(o.created_at) >= prevFrom && new Date(o.created_at) < from).reduce((a, o) => a + o.total, 0);
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
  A.orders.forEach(o => { if (o.status === 'cancelled') return; const i = idx[dayKey(o.created_at)]; if (i != null) { out[i].rev += o.total; out[i].n++; } });
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
  const max = niceMax(Math.max(...data.map(d => d.v)));
  const slot = pw / data.length, bw = Math.max(2, Math.min(24, slot - 2));
  const y = v => T + ph - (v / max) * ph;
  const ticks = [0, .25, .5, .75, 1].map(f => max * f);
  const every = Math.ceil(data.length / (W < 500 ? 5 : 8));
  const bar = (x, top, w, h) => { const r = Math.min(4, w / 2, h); return `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${top + h}Z`; };
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">
    <g class="grid">${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>
    <g class="axis">${ticks.map(v => `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`).join('')}
      ${data.map((d, i) => (i % every === 0 && (data.length - 1 - i >= every / 2 || i === data.length - 1)) || (i === data.length - 1) ? `<text x="${L + slot * i + slot / 2}" y="${H - 8}" text-anchor="middle">${fmtD(d.date)}</text>` : '').join('')}</g>
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
      <td><div class="no">${esc(o.order_no)}</div><div class="sm">${fmtDT(o.created_at)}</div></td>
      <td><span dir="auto">${esc(o.customer.name)}</span><div class="sm">${esc(o.customer.phone)} · ${o.fulfil === 'pickup' ? t('Pickup') : esc(cityLabel(o.city || ''))}</div></td>
      <td class="hide-m">${(o.items || []).reduce((a, i) => a + i.qty, 0)}</td>
      <td class="num">${money(o.total)}</td>
      <td class="hide-m">${t(PAY[o.payment])}<div style="margin-top:4px">${payPill(o.payment_status)}</div></td>
      <td>${statusPill(o.status)}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function viewOrders(tab) {
  if (tab) A.ui.otab = tab;
  const cur = A.ui.otab, q = A.ui.oq.trim().toLowerCase();
  const tabs = [['pending', 'New / Pending'], ['awaiting', 'Awaiting payment'], ['shipped', 'Shipped'], ['received', 'Received'], ['cancelled', 'Cancelled'], ['all', 'All']];
  const match = (o, k) => k === 'all' ? true : k === 'awaiting' ? o.payment_status === 'awaiting' && o.status !== 'cancelled' : o.status === k;
  let list = A.orders.filter(o => match(o, cur));
  if (q) list = list.filter(o => [o.order_no, o.customer.name, o.customer.phone, o.customer.email].join(' ').toLowerCase().includes(q));
  return head(t('Orders'), t('{n} orders in total · new orders appear here instantly', { n: A.orders.length })) + `
    <div class="tabs2">${tabs.map(([k, l]) => `<button class="${cur === k ? 'on' : ''}" data-act="go" data-href="#/orders/${k}">${t(l)}<i>${A.orders.filter(o => match(o, k)).length}</i></button>`).join('')}</div>
    <div class="atools"><input class="field" id="oq" type="search" placeholder="${t('Search order no, name or phone')}" value="${esc(A.ui.oq)}"></div>
    ${ordersTable(list)}`;
}
function openOrder(no) {
  A.ui.open = no; A.ui.cancelConfirm = false;
  renderDrawer(); $('#drawer').classList.add('open'); $('#scrim').classList.add('open');
}
function closeAll() {
  A.ui.open = null; A.ui.side = false;
  $('#drawer').classList.remove('open'); $('#scrim').classList.remove('open');
  const s = $('.adm-side'); if (s) s.classList.remove('open');
}
function renderDrawer() {
  const o = A.orders.find(x => x.order_no === A.ui.open); if (!o) return;
  const c = o.customer, h = o.history || {};
  const first = (c.name || '').split(' ')[0];
  const wa = (phone, text) => `https://wa.me/2${phone}?text=${encodeURIComponent(text)}`;
  const msgs = {
    pending: t('Hello {name}, thank you for your order {no} from ALLURE Boutique ({total}).', { name: first, no: o.order_no, total: money(o.total) }),
    shipped: t('Hello {name}, your ALLURE order {no} is on its way! ✨', { name: first, no: o.order_no }),
    received: t('Hello {name}, we hope you love your ALLURE pieces! Order {no}.', { name: first, no: o.order_no }),
    cancelled: t('Hello {name}, about your ALLURE order {no}:', { name: first, no: o.order_no }),
  };
  const next = { pending: [['shipped', 'MARK SHIPPED', 'btn-gold']], shipped: [['received', 'MARK RECEIVED', 'btn-gold']], received: [], cancelled: [['pending', 'RESTORE TO PENDING', 'btn-line']] }[o.status];
  const toReceive = o.payment === 'instapay' ? t('{amount} (full order)', { amount: money(o.total) })
    : t('{fee} delivery fee first, {rest} cash on delivery', { fee: money(o.delivery_fee), rest: money(o.total - o.delivery_fee) });
  $('#drawer').innerHTML = `<div class="hd"><div><div class="no">${esc(o.order_no)}</div><div class="sm muted" style="font-size:12px">${fmtDT(o.created_at)}</div></div>${statusPill(o.status)}
      <button class="icon-btn x" data-act="closeAll" aria-label="${t('Close')}">✕</button></div>
    <div class="bd">
      <div class="adm-card"><h3>${t('STATUS')}</h3>
        <div class="actions" style="margin-top:12px">
          ${next.map(([s, l, cls]) => `<button class="btn ${cls}" data-act="setStatus" data-s="${s}">${t(l)}</button>`).join('')}
          ${o.status === 'pending' || o.status === 'shipped' ? (A.ui.cancelConfirm
            ? `<button class="btn btn-danger" data-act="setStatus" data-s="cancelled">${t('CONFIRM CANCEL — STOCK IS RETURNED')}</button><button class="btn btn-line" data-act="cancelNo">${t('KEEP ORDER')}</button>`
            : `<button class="btn btn-danger" data-act="cancelAsk">${t('CANCEL ORDER')}</button>`) : ''}
        </div>
        <div class="kv" style="margin-top:16px">${['cart', 'pending', 'shipped', 'received', 'cancelled'].filter(k => h[k]).map(k => `<span class="k">${t(STATUS_LBL[k])}</span><span>${fmtDT(h[k])}</span>`).join('')}</div>
      </div>
      <div class="adm-card"><h3>${t('PAYMENT')}</h3>
        <div class="kv" style="margin-top:12px"><span class="k">${t('METHOD')}</span><span>${t(PAY[o.payment])}</span><span class="k">${t('STATUS')}</span><span>${payPill(o.payment_status)}</span>
          ${o.payment_status !== 'not_required' ? `<span class="k">${t('TO RECEIVE')}</span><span>${toReceive}</span>` : ''}</div>
        ${o.payment_status === 'awaiting' ? `<div class="actions" style="margin-top:14px"><button class="btn btn-ink" data-act="setPay" data-v="confirmed">${t('MARK PAYMENT RECEIVED')}</button></div>`
          : o.payment_status === 'confirmed' ? `<div class="actions" style="margin-top:14px"><button class="btn btn-line" data-act="setPay" data-v="awaiting">${t('UNDO — MARK AS NOT PAID')}</button></div>` : ''}
      </div>
      <div class="adm-card"><h3>${t('CUSTOMER')}</h3>
        <div class="kv" style="margin-top:12px"><span class="k">${t('NAME')}</span><span><span dir="auto">${esc(c.name)}</span> <span class="pill2 off">${o.user_id ? t('ACCOUNT') : t('GUEST')}</span></span>
          <span class="k">${t('PHONE')}</span><span dir="ltr" style="text-align:start">${esc(c.phone)}${c.phone2 ? ' / ' + esc(c.phone2) : ''}</span><span class="k">${t('EMAIL')}</span><span>${esc(c.email)}</span>
          <span class="k">${o.fulfil === 'pickup' ? t('PICKUP') : t('DELIVER TO')}</span><span dir="auto">${esc(o.address)}</span>
          ${o.note ? `<span class="k">${t('NOTE')}</span><span dir="auto">${esc(o.note)}</span>` : ''}</div>
        <div class="actions" style="margin-top:14px">
          <a class="btn btn-gold" href="${wa(c.phone, msgs[o.status])}" target="_blank" rel="noopener">${t('WHATSAPP')}</a>
          <a class="btn btn-line" href="tel:${esc(c.phone)}">${t('CALL')}</a></div>
      </div>
      <div class="adm-card"><h3>${t('ITEMS')}</h3>
        ${(o.items || []).map(i => `<div class="mini"><div class="th" style="${i.image ? `background:url('${esc(i.image)}') center/cover` : 'background:' + i.bg}"></div>
          <div><div class="nm">${esc(prodName(i.id, i.name))}</div><div class="d">#${esc(i.code)}${optText(i.opts) ? ' · ' + esc(optText(i.opts)) : ''}</div></div>
          <div class="pr">${i.qty} × ${money(i.unit)}</div></div>`).join('')}
        <div class="summary" style="border:none;padding:12px 0 0;margin:0;background:none">
          <div class="row"><span>${t('Subtotal')}</span><b>${money(o.subtotal)}</b></div>
          ${o.discount ? `<div class="row"><span>${t('Discount')} (${esc(o.promo_code)})</span><b>−${money(o.discount)}</b></div>` : ''}
          <div class="row"><span>${t('Delivery')}</span><b>${o.delivery_fee ? money(o.delivery_fee) : t('Free')}</b></div>
          <div class="row total"><span>${t('Total')}</span><b>${money(o.total)}</b></div></div>
      </div>
      <div class="adm-card"><h3>${t('INTERNAL NOTE')}</h3><p class="note">${t('Only you can see this.')}</p>
        <textarea class="field" id="adminNote" style="min-height:80px" dir="auto">${esc(o.admin_note)}</textarea>
        <div class="actions" style="margin-top:10px"><button class="btn btn-ink btn-sm" data-act="saveNote">${t('SAVE NOTE')}</button></div></div>
    </div>`;
}
async function patchOrder(patch, okMsg) {
  const o = A.orders.find(x => x.order_no === A.ui.open); if (!o) return;
  try {
    const row = await API.admin.updateOrder(o.id, patch);
    A.orders[A.orders.findIndex(x => x.id === o.id)] = row;
    A.ui.cancelConfirm = false;
    if (patch.status) A.products = await API.admin.products();   // stock may have changed
    toast(okMsg); render(); renderDrawer();
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
          <div class="photos">${p.images.map((u, i) => `<div class="photo-item" style="background-image:url('${esc(u)}')">${i === 0 ? `<span class="main">${t('MAIN')}</span>` : ''}
              <div class="ctl"><button type="button" data-act="imgMove" data-i="${i}" data-d="-1" aria-label="${t('Move earlier')}">‹</button><button type="button" data-act="imgRm" data-i="${i}" aria-label="${t('Remove')}">✕</button><button type="button" data-act="imgMove" data-i="${i}" data-d="1" aria-label="${t('Move later')}">›</button></div></div>`).join('')}
            <label class="photo-add">${A.ui.uploading ? t('UPLOADING…') : '+ ' + t('ADD PHOTOS')}<input type="file" id="pe-files" accept="image/*" multiple></label></div>
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
function viewSettings() {
  const s = A.settings, pr = s.promo || {};
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
          ${inp('address', t('Boutique address'), 'Value 2 Mall, New Cairo', 'text', 'ltr')}${inpAr('address_ar', t('Boutique address (Arabic)'), 'فاليو 2 مول، القاهرة الجديدة')}
          ${inp('hours', t('Opening hours'), '', 'text', 'ltr')}${inpAr('hours_ar', t('Opening hours (Arabic)'))}
          ${inp('mapsUrl', t('Google Maps link'), '', 'text', 'ltr')}${inp('socials.facebook', t('Facebook link'), '', 'text', 'ltr')}
          ${inp('socials.instagram', t('Instagram link'), '', 'text', 'ltr')}${inp('socials.tiktok', t('TikTok link'), '', 'text', 'ltr')}
          <div class="full">${inp('dashboardUrl', t('Dashboard link (added to Telegram alerts)'), 'https://yourshop.com/admin.html', 'text', 'ltr')}</div></div></div>
      <div class="adm-card"><h3>${t('DELIVERY FEES')}</h3><p class="note">${t('Customers choose their city at checkout. Branch pickup is always free.')}</p>
        <div class="rows">${deliv.map(({ city, fee, ar }, i) => `<div class="rowx c4"><input class="field" dir="ltr" data-deliv="${i}" data-k="city" value="${esc(city)}" placeholder="${t('City')}"><input class="field" dir="rtl" data-deliv="${i}" data-k="ar" value="${esc(ar || '')}" placeholder="${t('Arabic name')}"><input class="field" type="number" min="0" data-deliv="${i}" data-k="fee" value="${esc(fee)}" placeholder="${cur()}"><button type="button" class="rm" data-act="rmCity" data-i="${i}" aria-label="${t('Remove')}">✕</button></div>`).join('')}
          <button type="button" class="add-row" data-act="addCity">+ ${t('ADD CITY')}</button></div></div>
      <div class="adm-card"><h3>${t('CATEGORIES & SUBCATEGORIES')}</h3><p class="note">${t("Comma-separated. Renaming a subcategory doesn't move existing products — update them too. Arabic names go in the same order.")}</p>
        <div class="frm" style="grid-template-columns:1fr">${(s.categories || []).map((c, i) => `<div style="border-bottom:1px solid var(--line);padding-bottom:14px">
          <label>${esc(c.name)}</label>
          <div class="frm"><div><label>${t('Arabic name')}</label><input class="field" dir="rtl" data-catar="${i}" value="${esc(c.ar || '')}"></div><div></div>
          <div><label>${t('Subcategories')}</label><input class="field" dir="ltr" data-subs="${i}" value="${esc((c.subs || []).join(', '))}" placeholder="${t('No subcategories')}"></div>
          <div><label>${t('Subcategories (Arabic)')}</label><input class="field" dir="rtl" data-subsar="${i}" value="${esc((c.subs || []).map(x => (c.subs_ar || {})[x] || '').join('، '))}"></div></div></div>`).join('')}</div></div>
    </div>
    <div class="save-bar"><button class="btn btn-gold" type="submit">${t('SAVE SETTINGS')}</button><span class="msg${A.ui.sOk ? '' : ' err'}">${esc(A.ui.sMsg)}</span></div>
    </form>
    <div class="adm-card mt"><h3>${t('DISCOUNT CODES')}</h3><p class="note">${t('Customers type these in the cart. The discount applies to the items, not delivery.')}</p>
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
function viewNotifications() {
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const tg = A.ui.tg;
  const tgOk = tg && tg.token && tg.chat;
  const saved = v => tg ? (v ? `<span class="ok">✓ ${t('Saved')}</span>` : `<span class="bad">${t('Not set')}</span>`) : '…';
  return head(t('Notifications'), t('How you hear about every new order.')) + `
    <div class="adm-grid g2">
      <div class="adm-card"><h3>${t('TELEGRAM — ON YOUR PHONE')}</h3><p class="note">${t('A message for every new order, even when this dashboard is closed. Free.')}</p>
        <div class="kv" style="margin:6px 0 16px"><span class="k">${t('BOT TOKEN')}</span><span>${saved(tg && tg.token)}</span>
          <span class="k">${t('CHAT ID')}</span><span>${saved(tg && tg.chat)}</span></div>
        <div class="actions"><button class="btn btn-gold" data-act="tgTest"${tgOk ? '' : ' disabled'}>${t('SEND TEST MESSAGE')}</button><button class="btn btn-line" data-act="tgRefresh">${t('REFRESH STATUS')}</button></div>
        ${A.ui.tgMsg ? `<p class="note" style="margin-top:14px">${A.ui.tgMsg}</p>` : ''}
        <h3 style="margin-top:24px">${t('ONE-TIME SETUP (≈ 3 MINUTES)')}</h3>
        <ol class="steps">
          <li>${t('In Telegram, open {bf}, send {cmd}, choose a name (e.g. “ALLURE Orders”). It replies with a {token} like {ex}.', { bf: '<b>@BotFather</b>', cmd: '<b>/newbot</b>', token: `<b>${t('token')}</b>`, ex: '<code>123456:ABC-…</code>' })}</li>
          <li>${t('Open your new bot and press {start} (or add it to a group with your staff and send any message there).', { start: '<b>Start</b>' })}</li>
          <li>${t('Open {url} in a browser and copy the number after {key} — that’s your {chat} (groups start with −).', { url: '<b dir="ltr">https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</b>', key: '<b dir="ltr">"chat":{"id":</b>', chat: `<b>${t('chat ID')}</b>` })}</li>
          <li>${t('In Supabase → {sql}, run (with your values):', { sql: '<b>SQL Editor</b>' })}
            <div class="code">select vault.create_secret('PASTE_TOKEN', 'telegram_bot_token');
select vault.create_secret('PASTE_CHAT_ID', 'telegram_chat_id');</div></li>
          <li>${t('Come back here, press {a}, then {b}.', { a: `<b>${t('Refresh status')}</b>`, b: `<b>${t('Send test message')}</b>` })}</li>
        </ol></div>
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

// ───────────────────────── login / router ─────────────────────────
function viewLogin(denied) {
  const l = A.ui.login;
  return `<div class="login"><div class="box">
    <img class="logo-light" src="assets/logo-light.png" alt="ALLURE Boutique"><img class="logo-dark" src="assets/logo-dark.png" alt="ALLURE Boutique">
    <div class="eyebrow">${t('OWNER DASHBOARD')}</div>
    ${denied ? `<p class="page-sub" style="font-size:14px">${t('This account ({email}) is not an owner account.', { email: esc(A.profile && A.profile.email) })}</p>
      <button class="btn btn-line btn-block" style="margin-top:18px" data-act="signOut">${t('SIGN IN WITH ANOTHER ACCOUNT')}</button>
      <p class="note muted" style="font-size:12px;margin-top:16px">${t('To make an account the owner, see SETUP.md step 4.')}</p>`
    : `<form class="frm" data-form="login">
      <div><label for="lg-email">${t('Email')}</label><input id="lg-email" class="field" type="email" autocomplete="email" value="${esc(l.email)}" required></div>
      <div><label for="lg-pw">${t('Password')}</label><input id="lg-pw" class="field" type="password" autocomplete="current-password" required></div>
      ${l.msg ? `<div class="form-err">${esc(l.msg)}</div>` : ''}
      <button class="btn btn-gold btn-block" type="submit"${l.busy ? ' disabled' : ''}>${l.busy ? t('SIGNING IN…') : t('SIGN IN')}</button></form>`}
    <div class="login-lang">${langBtn()}</div>
  </div></div>`;
}
function route() {
  const [a, b] = (location.hash.replace(/^#\/?/, '') || 'overview').split('/').map(decodeURIComponent);
  switch (a) {
    case 'insights': return ['insights', viewInsights()];
    case 'orders': return ['orders', viewOrders(b)];
    case 'products': return ['products', b ? viewProductEdit(b) : viewProducts()];
    case 'reviews': return ['reviews', viewReviews(b)];
    case 'settings': return ['settings', viewSettings()];
    case 'notifications': return ['notifications', viewNotifications()];
    default: return ['overview', viewOverview()];
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
  lang: () => { I18N.set(isAr() ? 'en' : 'ar'); updateTitle(); render(); if (A.ui.open) renderDrawer(); },
  signOut: async () => { await API.auth.signOut(); },
  range: el => { A.ui.range = +el.dataset.d; render(); },
  insRange: el => { A.ui.insDays = +el.dataset.d; render(); },
  insRefresh: () => { loadInsights(true); render(); },
  bannerRm: () => { A.settings.promo = { ...(A.settings.promo || {}), image: '' }; sMsg(t('Image removed — press Save settings to publish.'), true); render(); },
  chartTable: () => { A.ui.chartTable = !A.ui.chartTable; render(); },
  openOrder: el => openOrder(el.dataset.no),
  setStatus: el => patchOrder({ status: el.dataset.s }, t('Order marked {s}', { s: t(STATUS_LBL[el.dataset.s]) })),
  cancelAsk: () => { A.ui.cancelConfirm = true; renderDrawer(); },
  cancelNo: () => { A.ui.cancelConfirm = false; renderDrawer(); },
  setPay: el => patchOrder({ payment_status: el.dataset.v }, el.dataset.v === 'confirmed' ? t('Payment marked as received') : t('Payment marked as not received')),
  saveNote: () => patchOrder({ admin_note: $('#adminNote').value }, t('Note saved')),
  // product editor
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

const FORMS = {
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
  if (e.target.closest('a[href]') && !e.target.closest('[data-act]')) return;
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act]; if (fn) { e.preventDefault(); fn(el); }
});
document.addEventListener('submit', e => { const f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault(); FORMS[f.dataset.form] && FORMS[f.dataset.form](); });
document.addEventListener('input', e => {
  const el = e.target, ed = A.ui.edit, ds = el.dataset;
  if (el.id === 'oq') { A.ui.oq = el.value; render(); return; }
  if (el.id === 'pq') { A.ui.pq = el.value; render(); return; }
  if (el.id === 'pcat') { A.ui.pcat = el.value; render(); return; }
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
  const cats = A.settings.categories || [];
  if (ds.catar != null) { cats[+ds.catar].ar = el.value.trim(); return; }
  if (ds.subs != null || ds.subsar != null) {
    const i = +(ds.subs != null ? ds.subs : ds.subsar), c = cats[i];
    if (ds.subs != null) c.subs = el.value.split(',').map(x => x.trim()).filter(Boolean);
    const arInput = document.querySelector(`[data-subsar="${i}"]`);
    const arList = (arInput ? arInput.value : '').split(/[,،]/).map(x => x.trim());
    c.subs_ar = Object.fromEntries((c.subs || []).map((s, k) => [s, arList[k] || '']).filter(([, v]) => v));
    return;
  }
  if (el.id === 'np-code' || el.id === 'np-pct' || el.id === 'np-exp') { A.ui.newPromo[{ 'np-code': 'code', 'np-pct': 'percent', 'np-exp': 'expires' }[el.id]] = el.value; }
});
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.id === 'banner-file' && el.files.length) {
    A.ui.bannerUp = true; render();
    try {
      const url = await API.admin.uploadImage(await shrink(el.files[0], 2400), 'banners');
      A.settings.promo = { ...(A.settings.promo || {}), image: url };
      sMsg(t('Image uploaded — press Save settings to publish it.'), true);
    } catch (x) { sMsg(t('Upload failed: {msg}', { msg: API.errMessage(x) })); }
    A.ui.bannerUp = false; render(); return;
  }
  if (el.id === 'pe-files' && el.files.length) {
    const ed = A.ui.edit; const files = [...el.files];
    const pid = ed._new ? slug(ed.name || 'new') + '-' + slug(ed.code || Date.now()) : ed.id;
    A.ui.uploading = true; render();
    for (const f of files) {
      try { ed.images.push(await API.admin.uploadImage(await shrink(f), pid)); }
      catch (x) { toast(t('Upload failed: {msg}', { msg: API.errMessage(x) })); }
    }
    A.ui.uploading = false; render();
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
window.addEventListener('hashchange', () => { if (A.phase === 'app') render(); });
let rT; window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { if (A.phase === 'app' && $('#revChart')) drawChart(); if (A.phase === 'app' && $('#insChart')) drawInsightsChart(); }, 150); });

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
  if (!A.profile || A.profile.role !== 'admin') { A.phase = 'denied'; A.profile = A.profile || { email: session.user.email }; return render(); }
  try { await loadAll(); } catch (e) { A.ui.login.msg = API.errMessage(e); A.phase = 'login'; return render(); }
  if (A.seen == null) markSeen();
  A.phase = 'app';
  if (!channel) channel = API.subscribeOrders('admin-orders', onOrderChange);
  if (!presence) {
    presence = API.presence('owner-' + A.profile.id);
    let pT = null;
    presence.on('presence', { event: 'sync' }, () => {
      A.live = summarizePresence(presence.presenceState());
      clearTimeout(pT); pT = setTimeout(() => { if (A.phase === 'app' && !$('input:focus, textarea:focus, select:focus')) render(); }, 400);
    }).subscribe();
  }
  API.admin.telegramStatus().then(s => { A.ui.tg = s; if (/notifications/.test(location.hash)) render(); }).catch(() => {});
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
