// Gera o índice de arquivos de src/ para o "cérebro" (docs/cerebro/_gerado/arquivos.md).
// Uso: npm run cerebro
// O arquivo gerado NÃO vai para o Git (está no .gitignore): ele é refeito sob demanda,
// então nunca fica velho nem causa conflito entre chats. Sem acesso a banco, rede ou segredos.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = new Set(['.js', '.jsx', '.css']);

export function areaDe(caminho) {
  const nome = caminho.split('/').pop();
  if (/^admin\/Mural/.test(caminho) || /^mural-/.test(nome) || /^public-image/.test(nome)) return 'Mural';
  if (/^commerce-|^ga-access/.test(nome) || /^commerce/.test(caminho) || /^ga\//.test(caminho)) return 'GA (Gestor de Anúncios)';
  if (/notification|dispatch|web-push|expedic/i.test(nome) || /^(notification-ui|expedicao)\//.test(caminho)) return 'Notificações e expedição';
  if (/router|edge-|operator-|worker|security|session|login|access/i.test(nome)) return 'Servidor (rotas, login, Worker)';
  if (/^admin\//.test(caminho)) return 'Painel administrativo (outros)';
  if (/sku|product|catalog|gtin|ean|image|print|label|scan/i.test(nome)) return 'ID, catálogo e produtos';
  return 'Outros';
}

export function descricaoDe(texto) {
  const linhas = texto.split('\n').slice(0, 8);
  for (const l of linhas) {
    const m = l.match(/^\s*\/\/\s*(.{12,})$/) || l.match(/^\s*\/\*+\s*(.{12,}?)\s*\*?\/?\s*$/);
    if (m && !/eslint|@ts-|use strict/i.test(m[1])) return m[1].replace(/\|/g, '/').slice(0, 150);
  }
  const exp = [...texto.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1]);
  if (exp.length) return ('exporta: ' + exp.slice(0, 5).join(', ') + (exp.length > 5 ? ` (+${exp.length - 5})` : '')).replace(/\|/g, '/');
  return '';
}

function listar(dir) {
  const saida = [];
  for (const nome of readdirSync(dir).sort()) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) saida.push(...listar(p));
    else if (EXT.has(nome.slice(nome.lastIndexOf('.')))) saida.push(p);
  }
  return saida;
}

export function gerar(raiz = RAIZ) {
  const src = join(raiz, 'src');
  const grupos = new Map();
  for (const arq of listar(src)) {
    const rel = relative(src, arq).split(sep).join('/');
    const texto = readFileSync(arq, 'utf8');
    const area = areaDe(rel);
    if (!grupos.has(area)) grupos.set(area, []);
    grupos.get(area).push({ rel, linhas: texto.split('\n').length, desc: rel.endsWith('.css') ? 'estilos' : descricaoDe(texto) });
  }
  const total = [...grupos.values()].reduce((n, g) => n + g.length, 0);
  let md = '# Índice de arquivos de `src/` (gerado)\n\n';
  md += 'Gerado por `npm run cerebro`. **Não edite à mão e não é versionado.** Refaça sempre que precisar.\n';
  md += 'A descrição vem do comentário no topo do arquivo; sem comentário, mostra o que ele exporta.\n\n';
  md += `Total: ${total} arquivos.\n`;
  for (const area of [...grupos.keys()].sort()) {
    md += `\n## ${area}\n\n| Arquivo | Linhas | O que é |\n|---|---|---|\n`;
    for (const f of grupos.get(area)) md += `| \`src/${f.rel}\` | ${f.linhas} | ${f.desc} |\n`;
  }
  return md;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const destino = join(RAIZ, 'docs', 'cerebro', '_gerado');
  mkdirSync(destino, { recursive: true });
  writeFileSync(join(destino, 'arquivos.md'), gerar());
  console.log('Índice gerado em docs/cerebro/_gerado/arquivos.md');
}
