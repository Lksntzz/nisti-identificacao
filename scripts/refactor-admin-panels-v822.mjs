import fs from 'node:fs';
import path from 'node:path';

function read(file) {
  return fs.readFileSync(path.resolve(file), 'utf8').replace(/\r\n/g, '\n');
}

function write(file, source) {
  fs.writeFileSync(path.resolve(file), source, 'utf8');
}

function replaceExact(source, from, to, label) {
  const occurrences = source.split(from).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Refatoração abortada: ${label} apareceu ${occurrences} vezes; esperado 1.`);
  }
  return source.replace(from, to);
}

function replaceBetween(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Refatoração abortada: início não encontrado (${label}).`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`Refatoração abortada: fim não encontrado (${label}).`);
  return source.slice(0, start) + replacement + source.slice(end);
}

let main = read('src/main.jsx');

main = replaceExact(
  main,
  "import { ADMIN_MENU_SECTIONS } from './admin-navigation.js';",
  "import { ADMIN_MENU_SECTIONS } from './admin-navigation.js';\nimport SystemHealthView from './system-health-view.jsx';\nimport GeometricShadowObservability from './geometric-shadow-observability.jsx';",
  'imports dos painéis administrativos'
);

main = replaceBetween(
  main,
  'function formatBytes(bytes) {',
  'function formatCurrentDateTime()',
  '',
  'formatBytes legado'
);

main = main.replace(
  "if (!dateVal) return { date: '18/05/2026', time: '20:00' };",
  "if (!dateVal) return { date: '—', time: '—' };"
);
main = main.replace(
  "return { date: '18/05/2026', time: '20:00' };",
  "return { date: '—', time: '—' };"
);

for (const [from, to] of [
  ['<span className="kpi-tag green">+24 esta semana</span>', '<span className="kpi-tag green">Catálogo atual</span>'],
  ['<span className="kpi-tag green">+18% vs ontem</span>', '<span className="kpi-tag green">Hoje</span>'],
  ['<span className="kpi-tag orange">+{unmatchedToday} pendentes</span>', '<span className="kpi-tag orange">Registrados hoje</span>'],
  ['<span className="kpi-tag green">Ativas</span>', '<span className="kpi-tag green">Com produtos cadastrados</span>'],
  ['Elas são salvas no banco de vetores (Vectorize) e são <strong>priorizadas com 100% de garantia</strong> nas próximas leituras, sem depender do Gemini e respondendo em menos de 50 milissegundos.', 'Elas são salvas como referências no Vectorize e passam a participar da recuperação visual. A aceitação final continua sujeita aos gates de segurança do reconhecimento.'],
  ['Fotos reais gravados no banco vetorial que aceleram o reconhecimento (&lt;100ms).', 'Fotos reais confirmadas e disponíveis como referências adicionais no Vectorize.']
]) {
  if (!main.includes(from)) throw new Error(`Refatoração abortada: texto esperado não encontrado: ${from}`);
  main = main.replace(from, to);
}

main = replaceBetween(
  main,
  '/* =========================================================================\n   SYSTEM LOGS & FREE TIER INFRASTRUCTURE METRICS VIEW',
  '/* =========================================================================\n   TEST COVER VERIFIER VIEW',
  '',
  'SystemLogsView legado'
);

main = replaceExact(
  main,
  "  const [activeView, setActiveView] = useState('catalogo');",
  "  const [activeView, setActiveView] = useState(\n    window.location.pathname === '/admin/shadow-observability' ? 'shadow-observability' : 'catalogo'\n  );",
  'estado inicial activeView'
);

main = replaceExact(
  main,
  "  const [indexInfo, setIndexInfo] = useState(null);\n",
  '',
  'estado indexInfo morto'
);

main = replaceExact(
  main,
  `  const refreshProducts = async () => {
    try {
      const [p, i] = await Promise.all([
        api('/api/products'),
        api('/api/admin/cover-index').catch(() => null)
      ]);
      setProducts(p.products || []);
      setIndexInfo(i);
    } catch (err) {
      if (/não autorizado|401|403/i.test(err.message)) {
        window.location.href = '/admin-login';
      }
    }
  };`,
  `  const refreshProducts = async () => {
    try {
      const p = await api('/api/products');
      setProducts(p.products || []);
    } catch (err) {
      if (/não autorizado|401|403/i.test(err.message)) {
        window.location.href = '/admin-login';
      }
    }
  };`,
  'refreshProducts sem cover-index morto'
);

main = replaceExact(
  main,
  "  const recognitionsToday = metrics?.recognition?.today?.attempts || 342;\n  const unmatchedToday = metrics?.recognition?.today?.unmatched || 23;",
  "  const recognitionsToday = metrics?.recognition?.today?.attempts ?? 0;\n  const unmatchedToday = metrics?.recognition?.today?.unmatched ?? 0;",
  'fallbacks fictícios dos KPIs'
);

main = replaceExact(
  main,
  "    return new Set(products.map(p => p.platform).filter(Boolean)).size || 4;",
  "    return new Set(products.map(p => p.platform).filter(Boolean)).size;",
  'fallback fictício de plataformas'
);

main = replaceExact(
  main,
  '  const handleNavChange = viewId => setActiveView(viewId);',
  `  const handleNavChange = viewId => {
    setActiveView(viewId);
    const nextPath = viewId === 'shadow-observability' ? '/admin/shadow-observability' : '/admin';
    if (window.location.pathname !== nextPath) {
      window.history.replaceState(null, '', nextPath);
    }
  };`,
  'navegação SPA do ADM'
);

main = replaceExact(
  main,
  `          {activeView === 'verificar' && (
            <CoverVerifierView />
          )}`,
  `          {activeView === 'shadow-observability' && (
            <GeometricShadowObservability embedded />
          )}

          {activeView === 'verificar' && (
            <CoverVerifierView />
          )}`,
  'render embutido do shadow'
);

main = replaceExact(
  main,
  `          {activeView === 'logs' && (
            <SystemLogsView
              metrics={metrics}
              storage={storage}
              indexInfo={indexInfo}
              onRefresh={refreshAll}
            />
          )}`,
  `          {activeView === 'logs' && (
            <SystemHealthView
              metrics={metrics}
              storage={storage}
              onRefresh={refreshAll}
            />
          )}`,
  'render Saúde & Logs'
);

for (const forbidden of [
  'function SystemLogsView',
  'indexInfo',
  'setIndexInfo',
  '100% Plano Gratuito (Zero Custos)',
  'Nenhuma cobrança será gerada',
  'Gemini 2.5 Flash',
  '1.500 req/dia',
  '100% de garantia',
  "|| 342",
  "|| 23",
  "|| 4",
  '18/05/2026'
]) {
  if (main.includes(forbidden)) {
    throw new Error(`Refatoração incompleta em main.jsx: ${forbidden}`);
  }
}

for (const required of [
  "import SystemHealthView from './system-health-view.jsx';",
  "import GeometricShadowObservability from './geometric-shadow-observability.jsx';",
  "activeView === 'shadow-observability'",
  '<GeometricShadowObservability embedded />',
  '<SystemHealthView'
]) {
  if (!main.includes(required)) throw new Error(`Conteúdo obrigatório ausente em main.jsx: ${required}`);
}

write('src/main.jsx', main);

let shadow = read('src/geometric-shadow-observability.jsx');
shadow = replaceExact(
  shadow,
  'export default function GeometricShadowObservability() {',
  'export default function GeometricShadowObservability({ embedded = false }) {',
  'assinatura GeometricShadowObservability'
);
shadow = replaceExact(
  shadow,
  '    <main className="shadow-observability-page">',
  '    <section className={`shadow-observability-page ${embedded ? \'embedded\' : \'standalone\'}`}>',
  'wrapper do shadow'
);
shadow = replaceExact(
  shadow,
  '          <a className="shadow-back-link" href="/admin">← Voltar ao Painel ADM</a>',
  '          {!embedded && <a className="shadow-back-link" href="/admin">← Voltar ao Painel ADM</a>}',
  'link voltar do shadow'
);
const lastMain = shadow.lastIndexOf('</main>');
if (lastMain < 0) throw new Error('Refatoração abortada: fechamento </main> do shadow não encontrado.');
shadow = shadow.slice(0, lastMain) + '</section>' + shadow.slice(lastMain + '</main>'.length);
write('src/geometric-shadow-observability.jsx', shadow);

let css = read('src/geometric-shadow-observability.css');
const marker = '/* Embedded inside the NISTI admin shell (v8.22) */';
if (!css.includes(marker)) {
  css += `\n\n${marker}\n.shadow-observability-page.embedded {\n  min-height: 0;\n  padding: 0;\n  background: transparent;\n}\n\n.shadow-observability-page.embedded .shadow-observability-header {\n  margin-bottom: 18px;\n}\n\n.shadow-observability-page.embedded .shadow-observability-footer {\n  margin-bottom: 0;\n}\n`;
}
write('src/geometric-shadow-observability.css', css);

console.log('✓ Saúde & Logs substituído por medições reais e referências documentais explícitas.');
console.log('✓ KPIs fictícios e garantias absolutas removidos do painel ADM.');
console.log('✓ Observabilidade Shadow agora abre dentro do shell administrativo sem recarregar a página.');
console.log('✓ Código morto de SystemLogsView/indexInfo removido.');
