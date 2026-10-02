import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const mural=fs.readFileSync(new URL('../src/mural-router.js',import.meta.url),'utf8');
const core=fs.readFileSync(new URL('../src/core-router.js',import.meta.url),'utf8');
const push=fs.readFileSync(new URL('../src/web-push.js',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');

test('product creation no longer creates automatic Mural drafts',()=>{
  assert.ok(core.includes('nisti_upsert_product_primary_v1'));
  assert.equal(core.includes('suggestMuralProductDraft'),false);
  assert.equal(mural.includes('suggestMuralProductDraft'),false);
  assert.equal(mural.includes("'system:suggestion'"),false);
});

test('Mural drafts are created only through the explicit admin publication flow',()=>{
  assert.ok(mural.includes('async function adminCreatePost'));
  assert.ok(mural.includes("VALUES (?,'draft'"));
  assert.ok(mural.includes("payload.published_at,payload.expires_at,'admin'"));
});

test('phase 5 push is explicit and restricted to important notices or selected products',()=>{
  assert.ok(mural.includes("post.kind === 'notice' && post.notice_level === 'important'"));
  assert.ok(mural.includes("|| post.kind === 'product'"));
  assert.ok(mural.includes("post.status !== 'published'"));
  assert.ok(mural.includes('/push$/'));
  assert.ok(admin.includes('Enviar notificação'));
  assert.ok(admin.includes('window.confirm'));
});

test('phase 5 reuses existing VAPID subscriptions and cleans dead endpoints',()=>{
  assert.ok(push.includes('export async function broadcastMuralPush'));
  assert.ok(push.includes('FROM push_subscriptions'));
  assert.ok(push.includes('sendWebPushNotification(env,sub,payload)'));
  assert.ok(push.includes('res.status===404||res.status===410'));
  assert.ok(push.includes('removePushSubscription(env,endpoint)'));
});

test('publishing the feed never dispatches mural push automatically',()=>{
  const publishStart=mural.indexOf('async function adminPublishPost');
  const pushStart=mural.indexOf('async function adminSendPush');
  assert.ok(publishStart>=0);
  const publishSource=mural.slice(publishStart,pushStart>publishStart?pushStart:publishStart+4000);
  assert.equal(publishSource.includes('broadcastMuralPush'),false);
});
