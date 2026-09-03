import fs from 'node:fs';
import path from 'node:path';

function read(file) {
  return fs.readFileSync(path.resolve(file), 'utf8').replace(/\r\n/g, '\n');
}
function write(file, value) {
  fs.writeFileSync(path.resolve(file), value, 'utf8');
}
function replaceOnce(source, from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: esperado 1 marcador, encontrado ${count}`);
  return source.replace(from, to);
}
function removeBetween(source, start, end, label) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`${label}: marcadores não encontrados`);
  return source.slice(0, a) + source.slice(b);
}

let main = read('src/main.jsx');
main = replaceOnce(
  main,
  "import { ADMIN_MENU_SECTIONS } from './admin-navigation.js';",
  "import { ADMIN_MENU_SECTIONS } from './admin-navigation.js';\nimport SystemHealthView from './system-health-view.jsx';\nimport GeometricShadowObservability from './geometric-shadow-observability.jsx';",
  'imports administrativos'
);
main = removeBetween(
  main,
  'function SystemLogsView(',
  '/* =========================================================================\n   TEST COVER VERIFIER VIEW',
  'SystemLogsView legado'
);
main = main.replace("  const [indexInfo, setIndexInfo] = useState(null);\n", '');
main = replaceOnce(
  main,
  `      const [p, i] = await Promise.all([\n        api('/api/products'),\n        api('/api/admin/cover-index').catch(() => null)\n      ]);\n      setProducts(p.products || []);\n      setIndexInfo(i);`,
  `      const p = await api('/api/products');\n      setProducts(p.products || []);`,
  'refreshProducts sem request morto'
);
main = replaceOnce(
  main,
  `          {activeView === 'verificar' && (\n            <CoverVerifierView />\n          )}`,
  `          {activeView === 'shadow-observability' && (\n            <GeometricShadowObservability embedded />\n          )}\n\n          {activeView === 'verificar' && (\n            <CoverVerifierView />\n          )}`,
  'render shadow embutido'
);
main = replaceOnce(
  main,
  `          {activeView === 'logs' && (\n            <SystemLogsView\n              metrics={metrics}\n              storage={storage}\n              indexInfo={indexInfo}\n              onRefresh={refreshAll}\n            />\n          )}`,
  `          {activeView === 'logs' && (\n            <SystemHealthView\n              metrics={metrics}\n              storage={storage}\n              onRefresh={refreshAll}\n            />\n          )}`,
  'painel Saúde & Logs'
);
for (const forbidden of ['SystemLogsView', 'indexInfo', 'setIndexInfo']) {
  if (main.includes(forbidden)) throw new Error(`main.jsx ainda contém código morto: ${forbidden}`);
}
write('src/main.jsx', main);

let shadow = read('src/geometric-shadow-observability.jsx');
shadow = replaceOnce(
  shadow,
  'export default function GeometricShadowObservability() {',
  'export default function GeometricShadowObservability({ embedded = false }) {',
  'prop embedded shadow'
);
shadow = replaceOnce(
  shadow,
  '    <main className="shadow-observability-page">',
  '    <section className={`shadow-observability-page ${embedded ? \'embedded\' : \'\'}`}>',
  'container shadow'
);
shadow = replaceOnce(
  shadow,
  '          <a className="shadow-back-link" href="/admin">← Voltar ao Painel ADM</a>',
  "          {!embedded && <a className=\"shadow-back-link\" href=\"/admin\">← Voltar ao Painel ADM</a>}",
  'backlink condicional'
);
shadow = replaceOnce(shadow, '    </main>\n  );\n}', '    </section>\n  );\n}', 'fechamento shadow');
write('src/geometric-shadow-observability.jsx', shadow);

let css = read('src/geometric-shadow-observability.css');
if (!css.includes('.shadow-observability-page.embedded')) {
  css += `\n\n/* v8.22: observabilidade integrada ao shell do Painel ADM */\n.shadow-observability-page.embedded {\n  min-height: 0;\n  background: transparent;\n  padding: 0;\n  font-family: inherit;\n}\n\n.shadow-observability-page.embedded .shadow-observability-header,\n.shadow-observability-page.embedded .shadow-error,\n.shadow-observability-page.embedded .shadow-loading,\n.shadow-observability-page.embedded .shadow-metrics-grid,\n.shadow-observability-page.embedded .shadow-rollout-card,\n.shadow-observability-page.embedded .shadow-platform-grid,\n.shadow-observability-page.embedded .shadow-evidence-card,\n.shadow-observability-page.embedded .shadow-observability-footer {\n  max-width: none;\n}\n\n.shadow-observability-page.embedded .shadow-observability-header {\n  border-radius: 14px;\n  box-shadow: none;\n}\n`;
}
write('src/geometric-shadow-observability.css', css);

let health = read('src/system-health-view.jsx');
health = health.replace(
  "setSyncMessage(`Reindexação concluída: ${data?.indexed || 0} referências sincronizadas.`);",
  "setSyncMessage(`Reindexação concluída: ${data?.processed?.length || 0} referências processadas · ${data?.vectorized || 0} vetores atualizados.`);"
);
write('src/system-health-view.jsx', health);

console.log('✓ Saúde & Logs usa somente métricas medidas/rotuladas corretamente.');
console.log('✓ Observabilidade Shadow agora é uma ferramenta embutida no Painel ADM.');
console.log('✓ SystemLogsView legado e request cover-index morto removidos.');
