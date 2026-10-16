// Lists English UI strings that have no Arabic translation in i18n.ar.js.  Usage: node tests/check_i18n.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
global.window = {}; eval(fs.readFileSync(path.join(root, 'i18n.ar.js'), 'utf8'));
const AR = window.I18N_AR, keys = new Set();
const lit = `'((?:[^'\\\\]|\\\\.)*)'`;
for (const f of ['app.js', 'admin.js', 'api.js', 'pages.js']) {
  const s = fs.readFileSync(path.join(root, f), 'utf8');
  for (const m of s.matchAll(new RegExp(`\\bt\\(\\s*${lit}`, 'g'))) keys.add(m[1]);
  for (const m of s.matchAll(new RegExp(`\\btr?\\(\\s*l,\\s*${lit}`, 'g'))) keys.add(m[1]);
  for (const m of s.matchAll(new RegExp(`\\bn1\\([^,]+,\\s*${lit},\\s*${lit}`, 'g'))) { keys.add(m[1]); keys.add(m[2]); }
  // [['key', 'Label'], …] pairs and { key: 'Label' } maps whose labels are passed through t() later
  for (const m of s.matchAll(new RegExp(`\\[\\s*'[a-z0-9_-]+',\\s*${lit}`, 'g'))) if (/[A-Z]/.test(m[1][0])) keys.add(m[1]);
  for (const line of s.split('\n')) if (/(LBL|labels|names|flagLbl|SORTS|COLLECTIONS|PAY|PAY_ST|PAY_STATUS|next = \{|PAYMENTS)\b/.test(line))
    for (const m of line.matchAll(new RegExp(`:\\s*${lit}`, 'g'))) if (/^[A-Z]/.test(m[1])) keys.add(m[1]);
}
const skip = new Set(['Instagram', 'Facebook', 'TikTok', 'Google', 'WhatsApp', 'X / Twitter', 'Snapchat', 'Bing']);
const miss = [...keys].filter(k => /[A-Za-z]/.test(k) && !(k in AR) && !skip.has(k)).sort();
console.log(miss.length ? miss.join('\n') : 'all translated');
process.exitCode = miss.length ? 1 : 0;
