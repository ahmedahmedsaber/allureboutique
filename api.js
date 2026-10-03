/* ALLURE Boutique — data layer shared by the shop (app.js) and the owner dashboard (admin.js).
   Talks to Supabase; every rule that matters (prices, stock, who can see what) is enforced in the database. */
(() => {
'use strict';

const cfg = window.ALLURE_CONFIG || {};
const ready = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
const sb = ready ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;

const unwrap = ({ data, error }) => { if (error) throw error; return data; };
const siteUrl = () => location.origin + location.pathname;

// database row ⇄ app shape
const fromRow = r => ({
  id: r.id, code: r.code, name: r.name, cat: r.cat, sub: r.sub || '',
  price: r.price, oldPrice: r.old_price || 0,
  material: r.material || '', size: r.size || '', color: r.color || '',
  comesWith: r.comes_with || [], desc: r.description || '',
  flags: r.flags || {}, stock: r.stock, inStock: r.stock > 0,
  rating: Number(r.rating) || 0, reviews: r.reviews_count || 0, popularity: r.popularity || 0,
  addedAt: r.created_at, images: r.images || [], bg: r.bg, options: r.options || {}, active: r.active,
  nameAr: r.name_ar || '', descAr: r.description_ar || '', materialAr: r.material_ar || '',
  sizeAr: r.size_ar || '', colorAr: r.color_ar || '', comesWithAr: r.comes_with_ar || [],
});
const toRow = p => ({
  id: p.id, code: p.code, name: p.name, cat: p.cat, sub: p.sub || null,
  price: Math.round(+p.price), old_price: p.oldPrice ? Math.round(+p.oldPrice) : null,
  material: p.material || '', size: p.size || '', color: p.color || '',
  comes_with: p.comesWith || [], description: p.desc || '',
  flags: p.flags || {}, stock: Math.max(0, Math.round(+p.stock || 0)),
  images: p.images || [], bg: p.bg, options: p.options || {}, active: p.active !== false,
  name_ar: p.nameAr || '', description_ar: p.descAr || '', material_ar: p.materialAr || '',
  size_ar: p.sizeAr || '', color_ar: p.colorAr || '', comes_with_ar: p.comesWithAr || [],
});

// friendly messages for errors raised by place_order() and Supabase Auth (translated by i18n.js)
function errMessage(e) {
  const t = (window.I18N && I18N.t) || (x => x);
  const m = (e && (e.message || e.error_description)) || String(e || '');
  const [code, a, b] = m.split(':');
  const fields = { name: 'your full name', email: 'a valid email', phone: 'a valid mobile number (01xxxxxxxxx)',
    phone2: 'a valid second number, or leave it empty', city: 'your city', region: 'your region / area',
    street: 'your street', building: 'your building', payment: 'a payment method', fulfil: 'delivery or pickup',
    qty: 'a valid quantity', items: 'fewer items' };
  const opts = { color: 'color', letter: 'letter', ringSize: 'ring size', bagSize: 'bag size', parts: 'set pieces' };
  if (code === 'INVALID' && a === 'promo') return t('This discount code is no longer valid.');
  if (code === 'INVALID') return t('Please enter {what}.', { what: t(fields[a] || 'the missing details') });
  if (code === 'OUT_OF_STOCK') return t('Sorry — “{name}” doesn’t have enough stock left. Please update your cart.', { name: a });
  if (code === 'NOT_FOUND') return t('One of the pieces in your cart is no longer available. Please update your cart.');
  if (code === 'OPTION') return t('Please choose the {what} for “{name}”.', { what: t(opts[b] || 'options'), name: a });
  if (code === 'EMPTY_CART') return t('Your cart is empty.');
  if (code === 'RATE_LIMIT') return t('Too many orders from this number in a short time. Please wait a few minutes or contact us on WhatsApp.');
  if (code === 'FORBIDDEN') return t('You don’t have permission to do that.');
  if (/Invalid login credentials/i.test(m)) return t('Wrong email or password.');
  if (/Email not confirmed/i.test(m)) return t('Please confirm your email first — check your inbox for our link.');
  if (/already registered/i.test(m)) return t('An account with this email already exists. Try signing in.');
  if (/Password should be/i.test(m)) return t('Your password needs at least 6 characters.');
  if (/rate limit/i.test(m)) return t('Too many attempts — please wait a few minutes and try again.');
  if (/Failed to fetch|NetworkError/i.test(m)) return t('Connection problem — please check your internet and try again.');
  return m || t('Something went wrong. Please try again.');
}

const API = {
  ready, sb, errMessage, fromRow, toRow,

  // ── catalogue ──
  async catalog() {
    const [s, p, r] = await Promise.all([
      sb.from('settings').select('data').eq('id', 1).maybeSingle(),
      sb.from('products').select('*').eq('active', true).order('popularity', { ascending: false }),
      sb.from('reviews').select('id,name,rating,text,created_at').eq('approved', true).order('created_at', { ascending: false }).limit(40),
    ]);
    return { settings: (unwrap(s) || {}).data || {}, products: unwrap(p).map(fromRow), reviews: unwrap(r) };
  },

  // ── auth ──
  auth: {
    async session() { return (await sb.auth.getSession()).data.session; },
    onChange(cb) { return sb.auth.onAuthStateChange((event, session) => cb(event, session)); },
    async signUp({ email, password, name, phone }) {
      return unwrap(await sb.auth.signUp({ email, password, options: { data: { name, phone }, emailRedirectTo: siteUrl() } }));
    },
    async signIn(email, password) { return unwrap(await sb.auth.signInWithPassword({ email, password })); },
    async signOut() { await sb.auth.signOut(); },
    async resetPassword(email) { return unwrap(await sb.auth.resetPasswordForEmail(email, { redirectTo: siteUrl() })); },
    async updatePassword(password) { return unwrap(await sb.auth.updateUser({ password })); },
  },
  async profile() {
    const s = await API.auth.session(); if (!s) return null;
    return unwrap(await sb.from('profiles').select('*').eq('id', s.user.id).maybeSingle());
  },
  async updateProfile(id, { name, phone }) {
    return unwrap(await sb.from('profiles').update({ name, phone }).eq('id', id).select().single());
  },

  // ── orders ──
  async placeOrder(payload) { return unwrap(await sb.rpc('place_order', { payload })); },
  async myOrders() { return unwrap(await sb.from('orders').select('*').order('created_at', { ascending: false })); },
  async trackOrder(orderNo, phone) { return unwrap(await sb.rpc('track_order', { p_order_no: orderNo, p_phone: phone })); },
  async checkPromo(code) { return unwrap(await sb.rpc('check_promo', { p_code: code })); },
  subscribeOrders(name, cb) {
    return sb.channel(name).on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, cb).subscribe();
  },

  // ── visitor insights ──
  trackEvent(ev) { sb.rpc('track_event', { p: ev }).then(() => {}, () => {}); },   // fire-and-forget
  presence(key) { return sb.channel('shop-presence', { config: { presence: { key } } }); },

  // ── reviews ──
  async submitReview(rating, text) { return unwrap(await sb.from('reviews').insert({ rating, text })); },

  // ── owner dashboard ──
  admin: {
    async isAdmin() { return unwrap(await sb.rpc('is_admin')); },
    async orders(sinceISO) {
      let q = sb.from('orders').select('*').order('created_at', { ascending: false }).limit(2000);
      if (sinceISO) q = q.gte('created_at', sinceISO);
      return unwrap(await q);
    },
    async updateOrder(id, patch) { return unwrap(await sb.from('orders').update(patch).eq('id', id).select().single()); },
    async products() { return unwrap(await sb.from('products').select('*').order('created_at', { ascending: false })).map(fromRow); },
    async saveProduct(p, isNew) {
      const row = toRow(p);
      const res = isNew ? await sb.from('products').insert(row).select().single()
                        : await sb.from('products').update(row).eq('id', p.id).select().single();
      return fromRow(unwrap(res));
    },
    async uploadImage(file, productId) {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${productId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      unwrap(await sb.storage.from('product-images').upload(path, file, { cacheControl: '31536000', upsert: false, contentType: file.type }));
      return sb.storage.from('product-images').getPublicUrl(path).data.publicUrl;
    },
    async removeImage(url) {
      const marker = '/product-images/'; const i = url.indexOf(marker); if (i < 0) return;
      await sb.storage.from('product-images').remove([decodeURIComponent(url.slice(i + marker.length))]);
    },
    async reviews() { return unwrap(await sb.from('reviews').select('*').order('created_at', { ascending: false })); },
    async setReviewApproved(id, approved) { return unwrap(await sb.from('reviews').update({ approved }).eq('id', id)); },
    async deleteReview(id) { return unwrap(await sb.from('reviews').delete().eq('id', id)); },
    async settings() { return (unwrap(await sb.from('settings').select('data').eq('id', 1).maybeSingle()) || {}).data || {}; },
    async saveSettings(data) { return unwrap(await sb.from('settings').update({ data }).eq('id', 1)); },
    async promos() { return unwrap(await sb.from('promo_codes').select('*').order('created_at', { ascending: false })); },
    async savePromo(p) { return unwrap(await sb.from('promo_codes').upsert(p)); },
    async deletePromo(code) { return unwrap(await sb.from('promo_codes').delete().eq('code', code)); },
    async insights(days) { return unwrap(await sb.rpc('admin_insights', { p_days: days })); },
    async telegramStatus() { return unwrap(await sb.rpc('admin_telegram_status')); },
    async testTelegram() { return unwrap(await sb.rpc('admin_test_telegram')); },
    async httpResult(id) { return unwrap(await sb.rpc('admin_http_result', { p_id: id })); },
  },
};
window.API = API;
})();
