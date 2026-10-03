/* ALLURE Boutique — English / Arabic.
   Strings are written in English in the code and looked up here when Arabic is on.
   I18N.t('Add to cart') → 'أضيفي للسلة'. Placeholders: I18N.t('Only {n} left', { n: 3 }). */
(() => {
'use strict';

const AR = window.I18N_AR || {};
let storeKey = 'au.lang';
let lang = 'en';

function read(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function t(s, v) {
  let r = lang === 'ar' && AR[s] != null ? AR[s] : s;
  if (v) r = r.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m));
  return r;
}
function apply() {
  const h = document.documentElement;
  h.lang = lang; h.dir = lang === 'ar' ? 'rtl' : 'ltr';
}
const I18N = {
  t,
  init(key, fallback = 'en') { storeKey = key; lang = read(key) || fallback; apply(); return lang; },
  set(l) { lang = l === 'ar' ? 'ar' : 'en'; try { localStorage.setItem(storeKey, JSON.stringify(lang)); } catch (e) {} apply(); },
  get lang() { return lang; },
  isAr: () => lang === 'ar',
  locale: () => (lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB'),
  /* the Arabic version of owner-entered text when it exists, otherwise the English */
  pick: (en, ar) => (lang === 'ar' && ar && String(ar).trim() ? ar : en),
  /* common option values (colors, set pieces) that aren't stored with an Arabic name */
  opt: s => (lang === 'ar' && OPT_AR[s]) || s,
  currency: () => (lang === 'ar' ? 'ج.م' : 'LE'),
};
const OPT_AR = {
  Pink: 'وردي', Gold: 'ذهبي', Silver: 'فضي', 'Rose Gold': 'ذهبي وردي', Rose: 'روز', Black: 'أسود', White: 'أبيض', Ivory: 'عاجي',
  Burgundy: 'عنابي', Camel: 'جملي', Brown: 'بني', Red: 'أحمر', Orange: 'برتقالي', Beige: 'بيج', Navy: 'كحلي', Green: 'أخضر',
  Blue: 'أزرق', Grey: 'رمادي', Gray: 'رمادي', Nude: 'نود', Tortoise: 'تورتواز', Champagne: 'شامبين', Pearl: 'لؤلؤي',
  Necklace: 'قلادة', Bracelet: 'سوار', Ring: 'خاتم', Earrings: 'حلق', Anklet: 'خلخال', Bangle: 'إسورة',
};
window.I18N = I18N;
})();
