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

test('AI assistant uses supported vision analysis and keeps pixel cleanup local', () => {
  const assistant=fs.readFileSync('src/ai-product-image-treatment.js','utf8');
  const core=fs.readFileSync('src/core-router.js','utf8');
  const worker=fs.readFileSync('src/product-image-treatment-worker.jsx','utf8');
  const admin=fs.readFileSync('src/admin/MuralNistiAdminView.jsx','utf8');
  const production=fs.readFileSync('wrangler.toml','utf8');
  const preview=fs.readFileSync('wrangler.preview.toml','utf8');

  assert.doesNotMatch(assistant,/@cf\/briaai\/rmbg-1\.4/);
  assert.match(assistant,/@cf\/moondream\/moondream3\.1-9B-A2B/);
  assert.match(assistant,/gemini-3\.5-flash/);
  assert.match(assistant,/confidence >= \.7/);
  assert.match(assistant,/task:'detect'/);
  assert.ok(core.includes("analyzeProductImageWithAi"));
  assert.ok(core.includes("detected_has_tassel"));
  assert.match(worker,/product-image-treatment\/\$\{item\.id\}\/ai/);
  assert.match(worker,/effectiveTasselCode=analysis\.detected_has_tassel \? 'AI' : 'X'/);
  assert.match(worker,/status:'local-fallback'/);
  assert.match(worker,/treatedProductImageBlob\(item\.original_image_url/);
  assert.match(admin,/treatmentProgress\.ai/);
  assert.match(admin,/IA aplicada/);
  for(const config of [production,preview]){
    assert.match(config,/\[ai\]\s+binding = "AI"/);
    assert.match(config,/AI_VISION_MODEL = "@cf\/moondream\/moondream3\.1-9B-A2B"/);
    assert.match(config,/GEMINI_IMAGE_MODEL = "gemini-3\.5-flash"/);
  }
});

test('Workers AI detector uses a base64 data URI without mutating product pixels', () => {
  const assistant=fs.readFileSync('src/ai-product-image-treatment.js','utf8');
  assert.match(assistant,/data:\$\{contentType \|\| 'image\/jpeg'\};base64/);
  assert.match(assistant,/target:'tassel thread pendant attached to the main planner or agenda'/);
  assert.doesNotMatch(assistant,/backgroundRemovalBytes/);
});
