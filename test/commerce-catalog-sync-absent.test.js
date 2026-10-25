import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeCommerceImportRow } from '../src/commerce-import-normalizer.js';

const read = p => fs.readFileSync(p, 'utf8');
const sync = read('supabase/migrations/20261025010000_commerce_catalog_sync_absent_v1.sql');
const evo = read('supabase/migrations/20261025010100_commerce_evolution_7d_active_variations_v1.sql');
const cand = read('supabase/migrations/20261025010200_commerce_variation_removal_candidates_v1.sql');
const reader = read('src/commerce-xlsx-reader.js');
const center = read('src/commerce-import-center.jsx');
const view = read('src/commerce-evolution-integrated.jsx');
const router = read('src/commerce-admin-router.js');

test('planilha ML: anúncio não ativo vira UMA observação de status, sem SKU', () => {
  assert.match(reader, /if \(status !== 'ACTIVE'\) \{\s*if \(inactiveObserved\.has\(id\)\) return;/);
  assert.match(reader, /column === 3 \|\| column === 4\) \? null : value/);
  const row = Array(30).fill(null); row[1] = 'MLB2897237300'; row[5] = 'Agenda Cactus';
  const parsed = normalizeCommerceImportRow({ marketplace: 'MERCADO_LIVRE', sheetName: 'Anúncios',
    rowNumber: 9, listingStatus: 'PAUSED', row });
  assert.equal(parsed.normalized.status_only, true);
  assert.equal(parsed.normalized.sku_primary, null);
  assert.equal(parsed.normalized.source_listing_status, 'PAUSED');
});

test('sincronização desativa (nunca apaga) anúncios ausentes e variações cujo SKU sumiu', () => {
  assert.match(sync, /'DEACTIVATE_ABSENT', 'LISTING'/);
  assert.match(sync, /'DEACTIVATE_VARIATION', 'VARIATION'/);
  assert.match(sync, /'REACTIVATE_VARIATION', 'VARIATION'/);
  assert.match(sync, /set listing_status = 'INACTIVE'/);
  assert.match(sync, /set relation_status = 'INACTIVE'/);
  assert.doesNotMatch(sync, /\bdelete from\b/i);
  assert.match(sync, /'deactivated_reason','ABSENT_FROM_IMPORT'/);
});

test('sincronização só com a planilha mais recente e confirmação extra em desativação grande', () => {
  assert.match(sync, /catalog_sync_not_latest_batch/);
  assert.match(sync, /catalog_sync_mass_confirmation_required/);
  assert.match(sync, /v_absent > greatest\(5, ceil\(v_prev_active \* 0\.3\)\)/);
  assert.match(sync, /v_vars_off > greatest\(10, ceil\(v_prev_vars \* 0\.3\)\)/);
  // variação só é julgada se o anúncio está ativo na planilha e tem SKUs nela
  assert.match(sync, /and exists \(select 1 from file_skus f where f\.ext = l\.external_listing_id\)/);
  assert.match(sync, /to service_role/);
});

test('tela de importação mostra prévia antes de aplicar e trata os erros de segurança', () => {
  assert.match(center, /Revisar anúncios que saíram da planilha/);
  assert.match(center, /function CatalogSyncPanel/);
  assert.match(center, /requires_mass_confirmation && !confirmMass/);
  assert.match(center, /catalog_sync_not_latest_batch/);
  assert.match(router, /\/sync-preview\$\//);
  assert.match(router, /\/sync-apply\$\//);
  assert.match(router, /body\?\.confirm_mass === true/);
});

test('evolução aceita 7 dias e esconde variações desativadas', () => {
  assert.match(evo, /case when p_days in \(7,30,60,90\) then p_days else 30 end days/);
  assert.match(evo, /lp\.relation_status not in \('REMOVED','INACTIVE'\)/);
  assert.doesNotMatch(evo, /lp\.relation_status<>'REMOVED'/);
  assert.match(evo, /complete_7/);
  assert.doesNotMatch(evo, /coalesce\(ad\.total_7 when/);
  assert.match(router, /!\[7,30,60,90\]\.includes\(days\)/);
});

test('variações candidatas: regra completa, somente leitura e aba própria', () => {
  assert.match(cand, /v\.verified and v\.complete_90 and v\.units_90=0/);
  assert.match(cand, /p\.selling_variations>=1/);
  assert.match(cand, /a\.ad_units_90 = p\.verified_units_90/);
  assert.match(cand, /l\.listing_status = 'ACTIVE'/);
  assert.match(cand, /case when v\.last_sale_date is null then 'NEVER' else 'STOPPED' end kind/);
  assert.doesNotMatch(cand, /\b(?:update|delete from|insert into|truncate)\s+public\./i);
  assert.match(view, /\['CANDIDATES','Variações para remover',null\]/);
  assert.match(view, /function RemovalCandidates/);
  assert.match(router, /\/listings\/manager\/variation-candidates/);
});
