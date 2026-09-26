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


test('reconciliação GS cria mestres apenas para casos unívocos', () => {
  const sql = read('supabase/migrations/20260925214500_commerce_preview_gs_master_reconciliation.sql');

  assert.equal(sql.includes("count(distinct gs_row_id)::int n"), true);
  assert.equal(sql.includes("c.n=1"), true);
  assert.equal(sql.includes("m.gs->>'status'='Ativo'"), true);
  assert.equal(sql.includes("m.gs->>'gtin'<>'305'"), true);
  assert.equal(sql.includes('preview Product Master created from unique GS SKU/GTIN'), true);
  assert.equal(sql.includes('preview GS catalog identity linked to Product Master'), true);
});

test('nome igual não vence uma capa SKU estruturada diferente', () => {
  const sql = read('supabase/migrations/20260925214500_commerce_preview_gs_master_reconciliation.sql');

  assert.equal(sql.includes("u.sku_pattern->>'signature'=l.sku_pattern->>'signature'"), true);
  assert.equal(sql.includes("nullif(u.sku_pattern->>'signature','') is null"), true);
  assert.equal(sql.includes("nullif(l.sku_pattern->>'signature','') is null"), true);
});

test('reconciliação mantém capa exata e coleção apenas como revisão', () => {
  const sql = read('supabase/migrations/20260925214500_commerce_preview_gs_master_reconciliation.sql');

  assert.equal(sql.includes("ps.sku)->>'signature'=u.signature"), true);
  assert.equal(sql.includes('preview SKU exact-cover link after GS master creation'), true);
  assert.equal(sql.includes('COVER_COLLECTION'), true);
  assert.equal(sql.toLowerCase().includes('security definer'), false);
});


test('NISTI ID só cria mestre para capa exata unívoca', () => {
  const sql = read('supabase/migrations/20260925215500_commerce_preview_nisti_exact_cover_reconciliation.sql');

  assert.equal(sql.includes("->>'signature'=u.pattern->>'signature'"), true);
  assert.equal(sql.includes('where c.n=1'), true);
  assert.equal(sql.includes("pml.source_kind='NISTI_ID'"), true);
  assert.equal(sql.includes("'NISTI_ID'"), true);
  assert.equal(sql.includes('preview exact-cover match to NISTI ID'), true);
  assert.equal(sql.includes('base_signature'), false);
});


test('SKU parser aceita acabamento legado de 2 letras sem perder a capa', () => {
  const sql = read('supabase/migrations/20260925221500_commerce_preview_remaining_catalog_reconciliation.sql');

  assert.equal(sql.includes("^[A-Z]{2,3}$"), true);
  assert.equal(sql.includes("'cover'"), true);
  assert.equal(sql.includes("'finish'"), true);
  assert.equal(sql.includes('preview legacy SKU match: exact family+cover from linked Shopee history; 2-letter finish supported'), true);
});

test('reconciliação final cria mestres apenas para casos isolados e mantém revisão manual', () => {
  const sql = read('supabase/migrations/20260925221500_commerce_preview_remaining_catalog_reconciliation.sql');

  assert.equal(sql.includes('Provisional exclusive set changed'), true);
  assert.equal(sql.includes('expected 54'), true);
  assert.equal(sql.includes('Final manual review count changed'), true);
  assert.equal(sql.includes('expected 12'), true);
  assert.equal(sql.includes('3811,4959,3658,4908'), true);
  assert.equal(sql.includes('3638,3639,3640,3641,4934,4935,4936,4937'), true);
});

test('resumo preview usa o estado real dos cards não vinculados', () => {
  const sql = read('supabase/migrations/20260925221500_commerce_preview_remaining_catalog_reconciliation.sql');

  assert.equal(sql.includes("from public.commerce_preview_management_products_v2(null,null,null,'UNLINKED',1000,0)"), true);
  assert.equal(sql.includes("'safe_candidates'"), true);
  assert.equal(sql.includes("'ambiguous_candidates'"), true);
  assert.equal(sql.includes("'no_safe_candidate'"), true);
  assert.equal(sql.toLowerCase().includes('security definer'), false);
});


test('resumo preview materializa os cards apenas uma vez', () => {
  const sql = read('supabase/migrations/20260925221500_commerce_preview_remaining_catalog_reconciliation.sql');

  assert.equal(sql.includes('actual_unlinked as materialized'), true);
  assert.equal(sql.includes("from public.commerce_preview_management_products_v2(null,null,null,'UNLINKED',1000,0)"), true);
  assert.equal(sql.includes("from public.commerce_preview_management_products_v2(null,null,null,'SKU_REVIEW',1,0)"), false);
  assert.equal(sql.includes("item->>'sku_review_available'"), true);
});


test('revisão manual final preserva variações estruturais fora da fila de Produto Mestre', () => {
  const sql = read('supabase/migrations/20260925224000_commerce_preview_close_manual_review.sql');

  assert.equal(sql.includes("resolution_status='VARIATION'"), true);
  assert.equal(sql.includes('PTD180_EPND_BBB aggregates EPND1/EPND2/EPND3'), true);
  assert.equal(sql.includes("sr.resolution_status='VARIATION'"), true);
  assert.equal(sql.includes('Final Product Master queue not empty'), true);
});

test('agenda escolar meninas mantém uma identidade por capa', () => {
  const sql = read('supabase/migrations/20260925224000_commerce_preview_close_manual_review.sql');

  assert.equal(sql.includes("'CAST','Cabelo Castanho',3638,4934"), true);
  assert.equal(sql.includes("'LOI','Cabelo Loiro',3639,4936"), true);
  assert.equal(sql.includes("'RUI','Cabelo Ruivo',3640,4937"), true);
  assert.equal(sql.includes("'CACH','Cabelo Preto Cacheado',3641,4935"), true);
  assert.equal(sql.includes("'CADMNA CAST BA','AGESCINMA_02'"), true);
  assert.equal(sql.includes("'CADMNA CACH BA','AGESCINMA_05'"), true);
});

test('Safari genérico e PLAN MPO usam a identidade do SKU sem reescrever dados da plataforma', () => {
  const sql = read('supabase/migrations/20260925224000_commerce_preview_close_manual_review.sql');

  assert.equal(sql.includes('VACMNO SAF BVV -> VACMNO_SFR_BVV'), true);
  assert.equal(sql.includes("'PLAN26 MPO PBP','CURRENT'"), true);
  assert.equal(sql.includes("'PLAN24 MPO PBP','HISTORICAL'"), true);
  assert.equal(sql.includes('Shopee title says White/2025 but SKU identifies MPO/2026'), true);
  assert.equal(sql.toLowerCase().includes('security definer'), false);
});
