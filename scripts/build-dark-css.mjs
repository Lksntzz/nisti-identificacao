// Gera src/commerce-dark.css: versão noturna das folhas de estilo do GA.
// Regra: inverte só a luminosidade de cada cor (matiz e saturação ficam), então vermelho segue vermelho e verde segue verde.
// Uso: node scripts/build-dark-css.mjs
import fs from 'node:fs';
import postcss from 'postcss';

const FILES = fs.readdirSync('src').filter(f => /^commerce-.*\.css$/.test(f) && f !== 'commerce-dark.css').map(f => 'src/' + f);
FILES.push('src/app.css', 'src/nisti-motion.css');
const GA_SELECTOR = /\.(admin-|sidebar|topbar|hamburger|commerce|ndb|nim|ga-|brand|nav-|btn-|badge|stat-|empty|toast|modal|table|card|pill|chip|tab)/;
const COLOR_PROP = /^(color|background|background-color|background-image|border|border-(top|right|bottom|left)(-color)?|border-color|outline|outline-color|box-shadow|text-shadow|fill|stroke|caret-color|accent-color|text-decoration-color|column-rule-color)$/;

const clamp = v => Math.min(1, Math.max(0, v));
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6;
  }
  return [h, s, l];
}
function hsl2rgb(h, s, l) {
  const f = (p, q, t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  if (!s) return [l, l, l].map(v => Math.round(v * 255));
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)].map(v => Math.round(v * 255));
}
function flip(r, g, b) {
  const [h, s, l] = rgb2hsl(r, g, b);
  const nl = 0.10 + (1 - l) * 0.80;           // branco -> ~#1a1d23, preto -> ~#e6e8ec
  const ns = l > .85 ? s * .5 : s * .9;       // fundos claros ficam menos "pesados"
  return hsl2rgb(h, clamp(ns), nl);
}
const hex2 = n => n.toString(16).padStart(2, '0');
function convert(value) {
  return value
    .replace(/#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\b/gi, (m, h) => {
      let x = h; if (x.length <= 4) x = x.split('').map(c => c + c).join('');
      const [r, g, b] = flip(parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16));
      return '#' + hex2(r) + hex2(g) + hex2(b) + (x.length === 8 ? x.slice(6) : '');
    })
    .replace(/rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)/gi, (m, r, g, b, a) => {
      const [R, G, B] = flip(+r, +g, +b);
      return a === undefined ? `rgb(${R},${G},${B})` : `rgba(${R},${G},${B},${a})`;
    })
    .replace(/\bwhite\b/gi, '#1a1d23').replace(/\bblack\b/gi, '#e6e8ec');
}

const out = ['/* GERADO por scripts/build-dark-css.mjs — não editar à mão. */'];
for (const file of FILES) {
  const root = postcss.parse(fs.readFileSync(file, 'utf8'));
  const emit = (rule, inAt) => {
    if (rule.parent?.type === 'atrule' && /keyframes/i.test(rule.parent.name)) return null;
    const decls = [];
    rule.each(d => { if (d.type === 'decl' && COLOR_PROP.test(d.prop) && /#[0-9a-f]{3}|rgb|white|black/i.test(d.value)) decls.push(`${d.prop}:${convert(d.value)}${d.important ? '!important' : ''}`); });
    if (!decls.length) return null;
    const sels = rule.selectors.filter(s => !/(^|[ >])\.(admin-sidebar|sidebar|commerce-sidebar)/.test(s) && ((file !== 'src/app.css' && file !== 'src/nisti-motion.css') || GA_SELECTOR.test(s)));
    if (!sels.length) return null;
    return sels.map(s => 'html.ga-dark ' + s.replace(/^(html|:root|body)\s+/, '')).join(',') + '{' + decls.join(';') + '}';
  };
  root.walkRules(rule => {
    const css = emit(rule);
    if (!css) return;
    let wrapped = css, p = rule.parent;
    while (p && p.type === 'atrule') { if (!/keyframes|font-face/i.test(p.name)) wrapped = `@${p.name} ${p.params}{${wrapped}}`; p = p.parent; }
    out.push(wrapped);
  });
}
// Fundos transparentes do visual limpo não são convertidos pelo gerador; reforça-os aqui.
out.push('html.ga-dark .ndb-sb-week,html.ga-dark .ndb-sb-week.is-cur{background:transparent;outline:0}');
out.push('html.ga-dark .ndb-table th,html.ga-dark .ndb-best-month,html.ga-dark .ndb-ext{background:transparent}');
out.push('html.ga-dark{background:#1a1d23;color:#e6e8ec;color-scheme:dark}');
out.push('html.ga-dark body{background:#14171c;color:#e6e8ec}');
out.push("html.ga-dark .commerce-theme-btn.is-on{background:#e6e8ec;color:#14213d}");
fs.writeFileSync('src/commerce-dark.css', out.join('\n') + '\n');
console.log('regras:', out.length, 'bytes:', fs.statSync('src/commerce-dark.css').size);
