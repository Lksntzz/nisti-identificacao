import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('Gestão é a visão principal do Catálogo Comercial', () => {
  const shell = read('src/commerce-admin-app-v2.jsx');
  assert.equal(shell.includes("{ id: 'management', label: 'Gestão' }"), true);
  assert.equal(shell.includes("useState('management')"), true);
  assert.equal(shell.includes('CommerceManagementView'), true);
});

test('fonte operacional da Gestão preserva regra de imagem por ano', () => {
  const sql = read('supabase/migrations/20260925170004_commerce_management_rows_v1.sql');
  assert.equal(sql.toLowerCase().includes('security definer'), false);
  assert.equal(sql.includes('commerce_image_years_compatible'), true);
  assert.equal(sql.replace(/\s+/g, ' ').includes("in ('ML_NOVO','ML_ANTIGO')"), true);
  assert.equal(sql.includes('grant execute on function public.commerce_management_rows_v1'), true);
});

test('Gestão prioriza fontes curadas sem apagar fontes antigas', () => {
  const sql = read('supabase/migrations/20260925170600_commerce_management_curated_sources_v2.sql');
  assert.equal(sql.includes("|| '_GESTAO'"), true);
  assert.equal(sql.includes('linked_image_url'), true);
  assert.equal(sql.includes('linked_image_reference'), true);
});

test('Gestão simplificada cruza produtos por Produto Mestre', () => {
  const sql = read('supabase/migrations/20260925183000_commerce_management_product_cards_v1.sql');

  assert.equal(sql.toLowerCase().includes('security definer'), false);
  assert.equal(sql.includes('commerce_management_products_v1'), true);
  assert.equal(sql.includes("'MULTI'"), true);
  assert.equal(sql.includes("'EXCLUSIVE'"), true);
  assert.equal(sql.includes("'UNLINKED'"), true);
  assert.equal(sql.includes("'items',mp.items"), true);
  assert.equal(sql.includes('count(*)::integer as platform_count'), true);
  assert.equal(sql.includes('commerce_preview_management_products_v1'), true);
  assert.equal(sql.includes('commerce_preview_products'), true);
});

test('API expõe cards e resumo da Gestão simplificada', () => {
  const router = read('src/commerce-admin-router.js');
  const store = read('src/commerce-supabase-store.js');

  assert.equal(router.includes('/management/products'), true);
  assert.equal(router.includes('/management/product-summary'), true);
  assert.equal(store.includes("'commerce_management_products_v2'"), true);
  assert.equal(store.includes("'commerce_management_product_summary_v2'"), true);
  assert.equal(store.includes("p_presence: cleanText(filters.presence) || 'LINKED'"), true);
});

test('interface mostra um card por produto e plataformas clicáveis', () => {
  const view = read('src/commerce-management-view.jsx');
  const css = read('src/commerce-management.css');

  assert.equal(view.includes('Um card por Produto Mestre'), true);
  assert.equal(view.includes('Cadastrado em'), true);
  assert.equal(view.includes('Multiplataforma'), true);
  assert.equal(view.includes('Exclusivo'), true);
  assert.equal(view.includes('Para vincular'), true);
  assert.equal(view.includes('setSelection({ card, platform })'), true);
  assert.equal(view.includes('SKU nesta plataforma'), true);
  assert.equal(view.includes('Origem da foto'), true);
  assert.equal(view.includes('Abrir anúncio'), true);
  assert.equal(css.includes('.commerce-product-card-grid'), true);
  assert.equal(css.includes('.commerce-product-platforms button'), true);
});

test('preview da Gestão continua isolado da produção', () => {
  const workflow = read('.github/workflows/commerce-preview.yml');
  const rpc = read('src/commerce-rpc.js');
  const seed = read('supabase/migrations/20260925181500_commerce_preview_management_v1.sql');
  const cards = read('supabase/migrations/20260925183000_commerce_management_product_cards_v1.sql');

  assert.equal(workflow.includes('feat/commerce-management'), true);
  assert.equal(rpc.includes("return name.replace(/^commerce_/, 'commerce_preview_')"), true);
  assert.equal(seed.includes('commerce_preview_source_files'), true);
  assert.equal(seed.includes('preview_snapshot'), true);
  assert.equal(cards.includes('commerce_preview_management_products_v1'), true);
  assert.equal(cards.includes('commerce_preview_management_product_summary_v1'), true);
});


test('resumo simplificado é leve e não mostra zero falso', () => {
  const sql = read('supabase/migrations/20260925184000_optimize_commerce_management_product_summary.sql');
  const view = read('src/commerce-management-view.jsx');

  assert.equal(sql.includes('commerce_management_product_summary_v1'), true);
  assert.equal(sql.includes('commerce_preview_management_product_summary_v1'), true);
  assert.equal(sql.includes('commerce_management_products_v1(null,null,null'), false);
  assert.equal(sql.includes('count(distinct code)'), true);
  assert.equal(view.includes("summaryError ? '—'"), true);
  assert.equal(view.includes('Indicadores indisponíveis no momento.'), true);
  assert.equal(view.includes('Tentar novamente'), true);
});


test('Gestão separa ambíguos e itens sem candidato seguro', () => {
  const store = read('src/commerce-supabase-store.js');
  const view = read('src/commerce-management-view.jsx');
  const css = read('src/commerce-management.css');
  const sql = read('supabase/migrations/20260925190000_commerce_management_link_audit_v1.sql');

  assert.equal(store.includes("'commerce_management_products_v2'"), true);
  assert.equal(sql.includes("'SAFE_CANDIDATE'"), true);
  assert.equal(sql.includes("'AMBIGUOUS'"), true);
  assert.equal(sql.includes("'NO_CANDIDATE'"), true);
  assert.equal(sql.includes('commerce_preview_source_rows'), true);
  assert.equal(sql.includes('exact name + category + year'), true);
  assert.equal(view.includes('Ambíguo'), true);
  assert.equal(view.includes('Sem candidato seguro'), true);
  assert.equal(view.includes('summary?.ambiguous_candidates'), true);
  assert.equal(view.includes('summary?.no_safe_candidate'), true);
  assert.equal(css.includes('.commerce-link-review.ambiguous'), true);
  assert.equal(css.includes('.commerce-link-review.no_candidate'), true);
});


test('fila ambígua compara candidatos e resolve somente no preview', () => {
  const router = read('src/commerce-admin-router.js');
  const store = read('src/commerce-supabase-store.js');
  const view = read('src/commerce-management-view.jsx');
  const css = read('src/commerce-management.css');
  const sql = read('supabase/migrations/20260925191500_commerce_management_link_review_v1.sql');

  assert.equal(router.includes('managementLinkReviewMatch'), true);
  assert.equal(router.includes('managementLinkResolveMatch'), true);
  assert.equal(router.includes('commercePreviewSandbox(env)'), true);
  assert.equal(router.includes('commerce_preview_only'), true);
  assert.equal(store.includes("'commerce_management_link_candidates_v2'"), true);
  assert.equal(store.includes("'commerce_management_resolve_link_v1'"), true);
  assert.equal(sql.toLowerCase().includes('security definer'), false);
  assert.equal(sql.includes('commerce_preview_management_resolve_link_v1'), true);
  assert.equal(sql.includes('Produto candidato inválido para esta linha.'), true);
  assert.equal(view.includes('Comparar'), true);
  assert.equal(view.includes('Vincular a este no preview'), true);
  assert.equal(view.includes('Revisão de vínculo'), true);
  assert.equal(view.includes('Homologação: a escolha abaixo altera somente o sandbox/preview.'), true);
  assert.equal(css.includes('.commerce-link-candidates'), true);
  assert.equal(css.includes('.commerce-link-candidate'), true);
});


test('referência GS aparece na investigação sem virar plataforma', () => {
  const store = read('src/commerce-supabase-store.js');
  const view = read('src/commerce-management-view.jsx');
  const css = read('src/commerce-management.css');
  const sql = read('supabase/migrations/20260925194500_commerce_management_gs_reference_v2.sql');

  assert.equal(store.includes("'commerce_management_link_candidates_v2'"), true);
  assert.equal(store.includes("'commerce_management_product_summary_v2'"), true);
  assert.equal(view.includes('Referência oficial GS'), true);
  assert.equal(view.includes('GTIN / EAN'), true);
  assert.equal(view.includes('Investigar vínculo'), true);
  assert.equal(view.includes('summary?.gs_reference_matches'), true);
  assert.equal(css.includes('.commerce-gs-reference'), true);
  assert.equal(sql.includes('GS_REFERENCIA'), true);
  assert.equal(sql.includes("'gs_reference'"), true);
  assert.equal(sql.includes("'gs_reference_matches'"), true);
  assert.equal(sql.includes('commerce_preview_source_rows'), true);
  assert.equal(sql.toLowerCase().includes('security definer'), false);
});


test('fallback de imagem GS só preenche faltas e preserva regra de ano', () => {
  const view = read('src/commerce-management-view.jsx');
  const sql = read('supabase/migrations/20260925201500_commerce_preview_gs_image_fallback.sql');

  assert.equal(sql.includes('commerce_preview_management_rows_v2'), true);
  assert.equal(sql.includes("when b.image_url is not null then b.image_source"), true);
  assert.equal(sql.includes("'GS_REFERENCE'"), true);
  assert.equal(sql.includes('commerce_image_years_compatible'), true);
  assert.equal(sql.includes("source_code='GS_REFERENCIA'"), true);
  assert.equal(sql.includes('commerce_preview_management_rows_v2('), true);
  assert.equal(sql.toLowerCase().includes('security definer'), false);
  assert.equal(view.includes('GS · imagem de referência'), true);
});


test('consulta dos cards expande o GS uma vez e evita fallback N+1', () => {
  const sql = read('supabase/migrations/20260925203000_optimize_preview_gs_card_query.sql');

  assert.equal(sql.includes('commerce_preview_management_products_v2'), true);
  assert.equal(sql.includes('commerce_preview_management_rows_v1('), true);
  assert.equal(sql.includes('commerce_preview_management_rows_v2('), false);
  assert.equal(sql.includes('gs_map as ('), true);
  assert.equal(sql.includes("source_code='GS_REFERENCIA'"), true);
  assert.equal(sql.includes('commerce_image_years_compatible'), true);
  assert.equal(sql.toLowerCase().includes('security definer'), false);
});


test('imagem quebrada troca automaticamente para fallback GS', () => {
  const view = read('src/commerce-management-view.jsx');
  const sql = read('supabase/migrations/20260925204000_preview_image_render_fallback.sql');

  assert.equal(view.includes('fallbackSrc = null'), true);
  assert.equal(view.includes('onError={() =>'), true);
  assert.equal(view.includes('setActiveSrc(fallbackSrc)'), true);
  assert.equal(view.includes('cardImageFallback(card)'), true);
  assert.equal(view.includes('fallbackSrc={item.fallback_image_url}'), true);
  assert.equal(sql.includes("'fallback_image_url',ar.fallback_image_url"), true);
  assert.equal(sql.includes('commerce_image_years_compatible'), true);
  assert.equal(sql.toLowerCase().includes('security definer'), false);
});


test('fila Revisão GS prioriza referências GS e vínculos seguros', () => {
  const view = read('src/commerce-management-view.jsx');
  const css = read('src/commerce-management.css');
  const sql = read('supabase/migrations/20260925205500_commerce_preview_gs_review_queue.sql');

  assert.equal(view.includes("GS_REVIEW: 'Revisão GS'"), true);
  assert.equal(view.includes("setPresence('GS_REVIEW')"), true);
  assert.equal(view.includes('commerce-gs-card-badge'), true);
  assert.equal(view.includes('summary.gs_reference_matches'), true);
  assert.equal(css.includes('.commerce-gs-review-filter'), true);
  assert.equal(css.includes('.commerce-gs-card-badge'), true);
  assert.equal(sql.includes("'GS_REVIEW'"), true);
  assert.equal(sql.includes('gs_reference_available'), true);
  assert.equal(sql.includes('preview GS safe link: unique legacy SKU + compatible name'), true);
  assert.equal(sql.includes('shared>=4'), true);
  assert.equal(sql.includes('>= 0.90'), true);
  assert.equal(sql.toLowerCase().includes('security definer'), false);
});


test('padrão de SKU preserva a capa específica e ignora ano/acabamento', () => {
  const sql = read('supabase/migrations/20260925212000_commerce_preview_sku_cover_matching.sql');

  assert.equal(sql.includes('commerce_sku_pattern_v1'), true);
  assert.equal(sql.includes("'cover_base'"), true);
  assert.equal(sql.includes("'cover_variant'"), true);
  assert.equal(sql.includes("'signature'"), true);
  assert.equal(sql.includes("'base_signature'"), true);
  assert.equal(sql.includes('preview SKU exact-cover link: same family + exact cover, year/finish ignored'), true);
  assert.equal(sql.includes("ps.sku)->>'signature'=u.signature"), true);
  assert.equal(sql.toLowerCase().includes('security definer'), false);
});

test('Revisão SKU mostra capa, variação e candidatos sem unir capas automaticamente', () => {
  const view = read('src/commerce-management-view.jsx');
  const css = read('src/commerce-management.css');
  const sql = read('supabase/migrations/20260925212000_commerce_preview_sku_cover_matching.sql');

  assert.equal(view.includes("SKU_REVIEW: 'Revisão SKU'"), true);
  assert.equal(view.includes("setPresence('SKU_REVIEW')"), true);
  assert.equal(view.includes('Padrão detectado do SKU'), true);
  assert.equal(view.includes('Coleção/base'), true);
  assert.equal(view.includes('A numeração da capa é preservada'), true);
  assert.equal(view.includes('Revisar capa'), true);
  assert.equal(view.includes('Capa exata no SKU Mestre'), true);
  assert.equal(view.includes('Mesma coleção de capas'), true);
  assert.equal(css.includes('.commerce-sku-pattern'), true);
  assert.equal(css.includes('.commerce-sku-card-badge'), true);
  assert.equal(sql.includes("'SKU_REVIEW'"), true);
  assert.equal(sql.includes("'COVER_COLLECTION'"), true);
  assert.equal(sql.includes('commerce_preview_management_resolve_link_v1'), true);
});
