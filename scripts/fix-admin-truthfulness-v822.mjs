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
  ]
];

for (const [from, to] of replacements) {
  if (source.includes(to)) continue;
  const count = source.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`Correção de texto: esperado 1 marcador, encontrado ${count}: ${from}`);
  }
  source = source.replace(from, to);
}

for (const forbidden of [
  '100% de garantia',
  'menos de 50 milissegundos',
  'sem depender do Gemini'
]) {
  if (source.includes(forbidden)) {
    throw new Error(`Afirmação não verificável ainda presente em src/main.jsx: ${forbidden}`);
  }
}

fs.writeFileSync(file, source, 'utf8');
console.log('✓ Texto da base vetorial corrigido: sem garantia absoluta, latência fixa ou independência fictícia do Gemini.');
