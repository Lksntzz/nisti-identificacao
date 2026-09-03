import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('src/main.jsx');
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const replacements = [
  [
    'Cérebro do Sistema (Auto-Aprendizado)',
    'Base Vetorial Supervisionada'
  ],
  [
    'Elas são salvas no banco de vetores (Vectorize) e são <strong>priorizadas com 100% de garantia</strong> nas próximas leituras, sem depender do Gemini e respondendo em menos de 50 milissegundos.',
    'Elas são salvas como referências supervisionadas e passam a compor a recuperação visual no Vectorize. Isso pode melhorar futuras leituras semelhantes, mas não garante prioridade, acerto ou latência fixa; a decisão final continua sujeita aos gates de confiança e às verificações configuradas.'
  ],
  [
    'const recognitionsToday = metrics?.recognition?.today?.attempts || 342;',
    'const recognitionsToday = Number(metrics?.recognition?.today?.attempts ?? 0);'
  ],
  [
    'const unmatchedToday = metrics?.recognition?.today?.unmatched || 23;',
    'const unmatchedToday = Number(metrics?.recognition?.today?.unmatched ?? 0);'
  ],
  [
    'return new Set(products.map(p => p.platform).filter(Boolean)).size || 4;',
    'return new Set(products.map(p => p.platform).filter(Boolean)).size;'
  ],
  [
    'productsCount={products.length || 1248}',
    'productsCount={products.length}'
  ],
  [
    '<span className="kpi-tag green">+24 esta semana</span>',
    '<span className="kpi-tag green">Dados atuais do catálogo</span>'
  ],
  [
    '<span className="kpi-tag green">+18% vs ontem</span>',
    '<span className="kpi-tag green">Medição registrada hoje</span>'
  ],
  [
    '<span className="kpi-tag orange">+{unmatchedToday} pendentes</span>',
    '<span className="kpi-tag orange">{unmatchedToday} registrados hoje</span>'
  ],
  [
    '<span className="kpi-tag green">Ativas</span>',
    '<span className="kpi-tag green">No catálogo</span>'
  ],
  [
    'Exemplos reais gravados no banco vetorial que aceleram o reconhecimento (&lt;100ms).',
    'Exemplos reais gravados no banco vetorial e usados como referências supervisionadas na recuperação visual.'
  ]
];

for (const [from, to] of replacements) {
  if (source.includes(to)) continue;
  const count = source.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`Correção de texto/dado: esperado 1 marcador, encontrado ${count}: ${from}`);
  }
  source = source.replace(from, to);
}

const fakeDateFallback = "return { date: '18/05/2026', time: '20:00' };";
const truthfulDateFallback = "return { date: '—', time: '' };";
const fakeDateCount = source.split(fakeDateFallback).length - 1;
if (fakeDateCount !== 0 && fakeDateCount !== 2) {
  throw new Error(`Fallback de data: esperado 0 ou 2 marcadores, encontrado ${fakeDateCount}`);
}
if (fakeDateCount === 2) {
  source = source.split(fakeDateFallback).join(truthfulDateFallback);
}

for (const forbidden of [
  '100% de garantia',
  'menos de 50 milissegundos',
  'sem depender do Gemini',
  '18/05/2026',
  '|| 342',
  '|| 23',
  'products.length || 1248',
  '.size || 4',
  '+24 esta semana',
  '+18% vs ontem',
  '+{unmatchedToday} pendentes',
  '(&lt;100ms)'
]) {
  if (source.includes(forbidden)) {
    throw new Error(`Afirmação/dado não verificável ainda presente em src/main.jsx: ${forbidden}`);
  }
}

fs.writeFileSync(file, source, 'utf8');
console.log('✓ Painel ADM sem métricas, datas, tendências, latências ou contagens fallback inventadas.');
