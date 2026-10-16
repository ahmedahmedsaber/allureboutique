/* ALLURE Boutique — standard text for the policy pages, and a tiny formatter for page text.
   The owner can replace any page (English and Arabic separately) in Dashboard → Pages.
   Format: "## " starts a heading, "- " a bullet, **bold**, blank line = new paragraph.
   {delivery_fees} and {address} are filled in automatically. */
(() => {
'use strict';
const P = (l) => { const t = (s, v) => I18N.tr(l, s, v); return {
  policy: [
    '## ' + t('Authenticity'), t('Every piece sold by ALLURE Boutique is inspected before it reaches you.'), '',
    '## ' + t('Exchanges & returns'),
    '- ' + t('Exchanges are accepted within 14 days of receiving your order, provided the item is unworn and in its original packaging.'),
    '- ' + t('Earrings and personalised pieces (such as initial necklaces) cannot be exchanged for hygiene and personalisation reasons.'),
    '- ' + t('Sale items can be exchanged but not refunded.'), '',
    '## ' + t('Orders'), t('Orders stay Pending until we confirm them. Orders paid by InstaPay or Vodafone Cash are confirmed once we receive your payment screenshot on WhatsApp.'),
  ].join('\n'),
  shipping: [
    '## ' + t('Delivery fees'), '{delivery_fees}', '',
    '## ' + t('Delivery time'), t('Cairo and Giza orders usually arrive within 2–3 working days; other governorates within 3–5 working days.'), '',
    '## ' + t('Cash on delivery'), t('For cash-on-delivery orders, the delivery fees are paid in advance via InstaPay or Vodafone Cash to confirm the order.'),
  ].join('\n'),
  terms: [
    t('By placing an order with ALLURE Boutique you agree to the following terms.'), '',
    '## ' + t('Prices & payment'), t('Prices are shown in Egyptian pounds (LE). We accept InstaPay / Vodafone Cash transfers and cash on delivery.'), '',
    '## ' + t('Availability'), t('Pieces are handpicked and often limited. If an item becomes unavailable after you order, we will contact you to offer an alternative or a refund.'), '',
    '## ' + t('Accounts & reviews'), t('You need to be signed in to submit feedback. Reviews are published after approval; we may remove reviews that are offensive or unrelated to our products.'),
  ].join('\n'),
}; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* escape first, then allow only headings, bullets, paragraphs and **bold** */
function render(text) {
  const out = []; let list = null, para = [];
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const flush = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } if (list) { out.push('<ul>' + list.map(x => '<li>' + inline(x) + '</li>').join('') + '</ul>'); list = null; } };
  String(text || '').replace(/\r/g, '').split('\n').forEach(line => {
    const l = line.trim();
    if (!l) return flush();
    if (l.startsWith('## ')) { flush(); out.push('<h2>' + inline(l.slice(3)) + '</h2>'); return; }
    if (/^[-•]\s+/.test(l)) { if (para.length) flush(); (list = list || []).push(l.replace(/^[-•]\s+/, '')); return; }
    if (list) flush();
    para.push(l);
  });
  flush();
  return out.join('');
}
window.PAGES = { slugs: ['policy', 'shipping', 'terms'], defaults: P, render };
})();
