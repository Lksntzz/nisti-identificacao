import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

const migration = () => read('supabase/migrations/202609221330_commerce_update_campaign_rpc_v1.sql');

test('campanha anual inclui apenas produtos ANNUAL da edição de origem', () => {
  const sql = migration();
  assert.equal(sql.includes("p.temporal_type = 'ANNUAL'"), true);
  assert.equal(sql.includes('p.edition_year = p_source_year'), true);
  assert.equal(sql.includes("p.internal_status <> 'DISCONTINUED'"), true);
  assert.equal(sql.includes("l.listing_status <> 'REMOVED'"), true);
});

test('campanha cria verificações obrigatórias separadas', () => {
  const sql = migration();
  for (const check of ['SKU', 'TITLE', 'DESCRIPTION', 'IMAGES', 'VIDEO', 'ATTRIBUTES']) {
    assert.equal(sql.includes(`'${check}'::text`), true, `${check} deve ser criado`);
  }
  assert.equal(sql.includes("('SKU'::text, true)"), true);
  assert.equal(sql.includes("('TITLE'::text, true)"), true);
  assert.equal(sql.includes("('DESCRIPTION'::text, true)"), true);
  assert.equal(sql.includes("('IMAGES'::text, true)"), true);
});

test('status geral depende das verificações obrigatórias e fechamento falha com pendências', () => {
  const sql = migration();
  assert.equal(sql.includes("bool_or(ch.status = 'BLOCKED') filter (where ch.is_required)"), true);
  assert.equal(sql.includes("bool_and(ch.status in ('OK', 'NOT_APPLICABLE')) filter (where ch.is_required)"), true);
  assert.equal(sql.includes('campaign_has_pending_items'), true);
});

test('RPCs anuais ficam restritas à service role', () => {
  const sql = migration();
  for (const fn of [
    'commerce_list_update_campaigns_v1',
    'commerce_create_update_campaign_v1',
    'commerce_list_update_items_v1',
    'commerce_update_item_v1',
    'commerce_set_update_check_v1',
    'commerce_close_update_campaign_v1'
  ]) {
    assert.equal(sql.includes(`public.${fn}`), true, `${fn} deve existir`);
  }
  assert.equal(sql.includes('from public, anon, authenticated'), true);
  assert.equal(sql.includes('to service_role'), true);
});

test('API e interface expõem a campanha anual sem acesso direto ao Supabase', () => {
  const router = read('src/commerce-update-admin-router.js');
  const view = read('src/commerce-update-view.jsx');
  const edge = read('src/edge-router.js');
  assert.equal(router.includes('/api/admin/commerce/update-campaigns'), true);
  assert.equal(router.includes('commerceSetUpdateCheck'), true);
  assert.equal(view.includes('Nova campanha anual'), true);
  assert.equal(view.includes('Salvar verificação'), true);
  assert.equal(view.includes('Fechar campanha'), true);
  assert.equal(edge.includes('handleCommerceUpdateAdminRequest'), true);
});
