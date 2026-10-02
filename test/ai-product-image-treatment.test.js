import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { __aiProductImageTreatmentInternals as internals } from '../src/ai-product-image-treatment.js';

test('Gemini tassel classifier accepts JSON and fenced JSON only', () => {
  assert.deepEqual(internals.parseGeminiJson('```json\n{"has_tassel":true,"confidence":0.92}\n```'),{
    has_tassel:true,confidence:0.92
  });
  assert.equal(internals.parseGeminiJson('sem resposta estruturada'),null);
});

test('AI image treatment combines Workers AI cutout with Gemini validation', () => {
  const assistant=fs.readFileSync('src/ai-product-image-treatment.js','utf8');
  const core=fs.readFileSync('src/core-router.js','utf8');
  const worker=fs.readFileSync('src/product-image-treatment-worker.jsx','utf8');
  const admin=fs.readFileSync('src/admin/MuralNistiAdminView.jsx','utf8');
  const production=fs.readFileSync('wrangler.toml','utf8');
  const preview=fs.readFileSync('wrangler.preview.toml','utf8');

  assert.match(assistant,/@cf\/briaai\/rmbg-1\.4/);
  assert.match(assistant,/gemini-2\.5-flash/);
  assert.match(assistant,/confidence >= \.7/);
  assert.ok(core.includes("/^\\/api\\/admin\\/product-image-treatment\\/(\\d+)\\/ai$/"));
  assert.match(core,/x-nisti-ai-tassel-disagrees/);
  assert.match(worker,/product-image-treatment\/\$\{item\.id\}\/ai/);
  assert.match(worker,/effectiveTasselCode='AI'/);
  assert.match(worker,/effectiveTasselCode='X'/);
  assert.match(worker,/preciseOutline:Boolean\(item\.force_outline\)/);
  assert.match(admin,/detail\.result\?\.warning/);
  for(const config of [production,preview]){
    assert.match(config,/\[ai\]\s+binding = "AI"/);
    assert.match(config,/AI_BACKGROUND_REMOVAL_MODEL = "@cf\/briaai\/rmbg-1\.4"/);
    assert.match(config,/GEMINI_IMAGE_MODEL = "gemini-2\.5-flash"/);
  }
});

test('binary Workers AI responses are normalized without image mutation', async () => {
  const source=new Uint8Array([137,80,78,71]);
  assert.deepEqual(await internals.backgroundRemovalBytes(source),source);
  assert.deepEqual(await internals.backgroundRemovalBytes(new Blob([source])),source);
  assert.deepEqual(await internals.backgroundRemovalBytes('data:image/png;base64,iVBORw=='),source);
});
