import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const mural=fs.readFileSync(new URL('../src/mural-router.js',import.meta.url),'utf8');
const core=fs.readFileSync(new URL('../src/core-router.js',import.meta.url),'utf8');
const push=fs.readFileSync(new URL('../src/web-push.js',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');

test('phase 5 suggests a draft only when a new product is created',()=>{
  assert.ok(core.includes('if (created)'));
  assert.ok(core.includes('suggestMuralProductDraft(env, product.id)'));
  assert.ok(mural.includes("status<>'archived'"));
  assert.ok(mural.includes("'product','draft'"));
  assert.ok(mural.includes("'system:suggestion'"));
});

test('phase 5 never auto publishes suggested product content',()=>{
  const start=mural.indexOf('export async function suggestMuralProductDraft');
  const end=mural.indexOf('async function adminSendPush',start);
  const source=mural.slice(start,end);
  assert.ok(source.includes("'draft'"));
  assert.equal(source.includes("'published'"),false);
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
