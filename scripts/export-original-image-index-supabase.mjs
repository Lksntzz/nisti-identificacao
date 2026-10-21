// Gera o índice de imagens originais usando o catálogo AUTORITATIVO do Supabase.
// Requer credencial privada apenas no GitHub Actions; nunca a grava em arquivos.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function fetchOriginalImageIndex({
  supabaseUrl,
  serviceKey,
  fetchImpl = fetch,
  pageSize = 500
}) {
  let base;
  try {
    base = new URL(String(supabaseUrl || ''));
  } catch {
    throw new Error('SUPABASE_URL ausente ou inválida.');
  }
  if (base.protocol !== 'https:' || !base.hostname || base.username || base.password) {
    throw new Error('SUPABASE_URL precisa usar HTTPS sem credenciais na URL.');
  }
  if (!serviceKey || !String(serviceKey).trim()) {
    throw new Error('Secret SUPABASE_SERVICE_ROLE_KEY ausente. Exportação cancelada sem fallback D1.');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error('pageSize fora do intervalo permitido (1-1000).');
  }

  const products = [];
  let lastId = 0;
  for (let page = 0; page < 10000; page++) {
    const url = new URL('/rest/v1/products', base);
    url.searchParams.set('select', 'id,sku,image_key');
    url.searchParams.set('image_key', 'not.is.null');
    url.searchParams.set('id', 'gt.' + lastId);
    url.searchParams.set('order', 'id.asc');
    url.searchParams.set('limit', String(pageSize));

    let response;
    try {
      response = await fetchImpl(url.toString(), {
        headers: {
          apikey: serviceKey,
          Authorization: 'Bearer ' + serviceKey,
          Accept: 'application/json',
          Prefer: 'count=exact'
        }
      });
    } catch {
      throw new Error('Falha de conexão ao consultar imagens no Supabase. Exportação cancelada.');
    }
    if (!response?.ok) {
      throw new Error('Supabase retornou HTTP ' + (response?.status || 'desconhecido') + '. Exportação cancelada.');
    }

    // Detecta limite de linhas do PostgREST (max_rows) para nunca truncar silenciosamente.
    const range = response.headers?.get('content-range') || '';
    const totalPart = range.split('/').at(-1);
    if (!/^\d+$/.test(totalPart || '')) {
      throw new Error('Supabase não informou o total da página. Exportação cancelada para evitar índice incompleto.');
    }
    const expectedRemaining = Number(totalPart);
    let rows;
    try {
      rows = await response.json();
    } catch {
      throw new Error('Resposta de índice do Supabase não é JSON válido.');
    }
    if (!Array.isArray(rows) || rows.length > pageSize || rows.length > expectedRemaining) {
      throw new Error('Resposta de índice do Supabase contém contagem inconsistente.');
    }
    if (!rows.length && expectedRemaining > 0) {
      throw new Error('Paginação do Supabase retornou página vazia antes do fim.');
    }
    for (const item of rows) {
      const id = Number(item?.id);
      if (!Number.isSafeInteger(id) || id <= lastId
        || !String(item?.sku || '').trim() || !String(item?.image_key || '').trim()) {
        throw new Error('Índice de imagens inválido, duplicado ou fora de ordem.');
      }
      products.push({ id, sku: String(item.sku), image_key: String(item.image_key) });
      lastId = id;
    }
    if (rows.length === expectedRemaining) {
      if (!products.length) throw new Error('Nenhuma imagem original indexada no Supabase. Exportação cancelada.');
      return products;
    }
  }
  throw new Error('Índice excedeu o limite seguro de páginas.');
}

export async function writeOriginalImageIndex({ supabaseUrl, serviceKey, outputPath, fetchImpl = fetch, pageSize = 500 }) {
  if (!outputPath) throw new Error('Informe caminho de saída do índice.');
  const rows = await fetchOriginalImageIndex({ supabaseUrl, serviceKey, fetchImpl, pageSize });
  await mkdir(path.dirname(outputPath), { recursive: true });
  // Mantém o formato consumido pelo exportador de imagens R2, anteriormente produzido pelo Wrangler D1.
  await writeFile(outputPath, JSON.stringify([{ results: rows }], null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  return rows.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  writeOriginalImageIndex({
    supabaseUrl: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    outputPath: process.argv[2] || 'export/products.json'
  }).then(count => {
    console.log('Índice de imagens obtido do Supabase: ' + count + ' produtos.');
  }).catch(error => {
    // Nunca imprimir payloads, headers ou credenciais.
    console.error('[export] ' + error.message);
    process.exitCode = 1;
  });
}
