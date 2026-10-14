import test from 'node:test';
import assert from 'node:assert/strict';
import { commerceSalesImportInternals } from '../src/commerce-sales-import-reader.js';
const ok=commerceSalesImportInternals.isConfirmedShopeeOrder;
test('Shopee imports only confirmed paid orders',()=>{
  for (const status of ['Concluído','Entregue','Enviado','A Enviar','Pedido Recebido','O comprador pode pedir uma devolução até 2026-10-06']) {
    assert.equal(ok(status,'2026-09-10 11:20'),true,status);
  }
  for (const status of ['Cancelado','Reembolsado','Pagamento pendente','Aguardando pagamento','']) {
    assert.equal(ok(status,'2026-09-10 11:20'),false,status);
  }
  assert.equal(ok('Concluído',''),false,'payment confirmation is required');
});
