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

test('Gestão possui endpoint e RPC próprios somente de leitura', () => {
  const router = read('src/commerce-admin-router.js');
  const store = read('src/commerce-supabase-store.js');
  const sql = read('supabase/migrations/20260925170004_commerce_management_rows_v1.sql');
  assert.equal(router.includes('/management'), true);
  assert.equal(store.includes("'commerce_management_rows_v1'"), true);
  assert.equal(sql.toLowerCase().includes('security definer'), false);
  assert.equal(sql.includes('commerce_image_years_compatible'), true);
  assert.equal(sql.includes("source_code)='ML_NOVO'"), false);
  assert.equal(sql.replace(/\s+/g, ' ').includes("in ('ML_NOVO','ML_ANTIGO')"), true);
  assert.equal(sql.includes('grant execute on function public.commerce_management_rows_v1'), true);
});

test('Gestão separa fontes operacionais e mostra origem da imagem', () => {
  const view = read('src/commerce-management-view.jsx');
  for (const source of ['SHOPEE', 'ML_NOVO', 'ML_ANTIGO', 'AMAZON', 'SHEIN']) {
    assert.equal(view.includes(source), true, source);
  }
  assert.equal(view.includes('Origem da imagem'), true);
  assert.equal(view.includes('Outra plataforma compatível'), true);
  assert.equal(view.includes('Produto Mestre'), true);
  assert.equal(view.includes('Abrir anúncio'), true);
});


test('Gestão prioriza fonte curada sem alterar a fonte comercial original', () => {
  const sql = read('supabase/migrations/20260925170600_commerce_management_curated_sources_v2.sql');
  assert.equal(sql.includes("|| '_GESTAO'"), true);
  assert.equal(sql.includes("linked_image_url"), true);
  assert.equal(sql.includes("linked_image_reference"), true);
  assert.equal(sql.includes("like '%IN STOCK%'"), true);
  assert.equal(sql.includes("then 'ACTIVE'"), true);
  assert.equal(sql.includes("then 'OTHER_MARKETPLACE'"), true);
});


test('painel de Gestão compara o mesmo produto entre plataformas', () => {
  const router = read('src/commerce-admin-router.js');
  const store = read('src/commerce-supabase-store.js');
  const view = read('src/commerce-management-view.jsx');
  const sql = read('supabase/migrations/20260925172400_commerce_management_detail_v1.sql');

  assert.equal(router.includes('managementDetailMatch'), true);
  assert.equal(router.includes('commerceManagementDetail(env, sourceRowId)'), true);
  assert.equal(store.includes("'commerce_management_detail_v1'"), true);
  assert.equal(sql.toLowerCase().includes('security definer'), false);
  assert.equal(sql.includes("o.source_code||'_GESTAO'"), true);
  assert.equal(view.includes('Mesmo produto em outras plataformas'), true);
  assert.equal(view.includes('Pendências'), true);
  assert.equal(view.includes('Sem foto segura'), true);
  assert.equal(view.includes('/management/${sourceRowId}/details'), true);
});
