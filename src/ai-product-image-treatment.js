const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
const DEFAULT_WORKERS_VISION_MODEL = '@cf/moondream/moondream3.1-9B-A2B';

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function parseGeminiJson(text) {
  const normalized = String(text || '').trim().replace(/^\`\`\`(?:json)?\\s*/i, '').replace(/\\s*\`\`\`$/, '');
  const start = normalized.indexOf('{');
  const end = normalized.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(normalized.slice(start, end + 1)); } catch { return null; }
}

async function classifyTasselWithGemini(bytes, contentType, env) {
  if (!env.GEMINI_API_KEY) return { available:false, provider:'gemini', has_tassel:null, confidence:0, reason:'GEMINI_API_KEY ausente.' };
  const model = String(env.GEMINI_IMAGE_MODEL || DEFAULT_GEMINI_MODEL).trim();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method:'POST',
      headers:{ 'content-type':'application/json', 'x-goog-api-key':env.GEMINI_API_KEY },
      body:JSON.stringify({
        contents:[{ parts:[
          { text:'Analise somente o produto principal. Responda JSON puro: {"has_tassel":boolean,"confidence":number,"reason":string}. Tassel é o pingente de fios preso à agenda; não confunda wire-o, elástico, sombra, logo ou decoração impressa com tassel.' },
          { inlineData:{ mimeType:contentType || 'image/jpeg', data:bytesToBase64(bytes) } }
        ] }],
        generationConfig:{ responseMimeType:'application/json', temperature:0, maxOutputTokens:160 }
      })
    }
  );
  if (!response.ok) {
    let detail='';
    try {
      const errorPayload=await response.json();
      detail=String(errorPayload?.error?.message || errorPayload?.error?.status || '').trim();
    } catch {}
    throw new Error(`Gemini ${model} respondeu HTTP ${response.status}${detail ? `: ${detail}` : '.'}`);
  }
  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map(part=>part?.text || '').join('') || '';
  const parsed = parseGeminiJson(text);
  if (!parsed || typeof parsed.has_tassel !== 'boolean') throw new Error('Gemini retornou classificação inválida.');
  return {
    available:true,
    provider:'gemini',
    model,
    has_tassel:parsed.has_tassel,
    confidence:Math.max(0,Math.min(1,Number(parsed.confidence || 0))),
    reason:String(parsed.reason || '').slice(0,240)
  };
}

async function classifyTasselWithWorkersAi(bytes, contentType, env) {
  if (!env.AI?.run) return { available:false, provider:'workers-ai', has_tassel:null, confidence:0, reason:'Binding AI ausente.' };
  const model = String(env.AI_VISION_MODEL || DEFAULT_WORKERS_VISION_MODEL).trim();
  const image = `data:${contentType || 'image/jpeg'};base64,${bytesToBase64(bytes)}`;
  const result = await env.AI.run(model,{
    task:'detect',
    image,
    target:'tassel thread pendant attached to the main planner or agenda',
    max_objects:4
  });
  const objects = Array.isArray(result?.objects) ? result.objects : [];
  if (objects.length) {
    return { available:true, provider:'workers-ai', model, has_tassel:true, confidence:.75, reason:'Workers AI localizou um tassel no produto.' };
  }
  return { available:true, provider:'workers-ai', model, has_tassel:null, confidence:0, reason:'Workers AI não localizou tassel com confiança suficiente.' };
}

export async function analyzeProductImageWithAi(imageObject, tasselCode, env) {
  const bytes = new Uint8Array(await imageObject.arrayBuffer());
  const contentType = imageObject.httpMetadata?.contentType || 'image/jpeg';
  const registeredHasTassel = String(tasselCode || '').trim().toUpperCase() !== 'X';
  const attempts=[];

  try {
    const gemini=await classifyTasselWithGemini(bytes,contentType,env);
    attempts.push(gemini);
    if (gemini.available && gemini.confidence >= .7 && typeof gemini.has_tassel === 'boolean') {
      return {
        applied:true,
        provider:'gemini',
        model:gemini.model,
        registeredHasTassel,
        detectedHasTassel:gemini.has_tassel,
        confidence:gemini.confidence,
        tasselDisagrees:gemini.has_tassel !== registeredHasTassel,
        reason:gemini.reason,
        attempts
      };
    }
  } catch(error) {
    attempts.push({available:false,provider:'gemini',has_tassel:null,confidence:0,reason:error.message});
  }

  try {
    const workers=await classifyTasselWithWorkersAi(bytes,contentType,env);
    attempts.push(workers);
    if (workers.available && typeof workers.has_tassel === 'boolean') {
      return {
        applied:true,
        provider:'workers-ai',
        model:workers.model,
        registeredHasTassel,
        detectedHasTassel:workers.has_tassel,
        confidence:workers.confidence,
        tasselDisagrees:workers.has_tassel !== registeredHasTassel,
        reason:workers.reason,
        attempts
      };
    }
  } catch(error) {
    attempts.push({available:false,provider:'workers-ai',has_tassel:null,confidence:0,reason:error.message});
  }

  return {
    applied:false,
    provider:'local-fallback',
    model:null,
    registeredHasTassel,
    detectedHasTassel:null,
    confidence:0,
    tasselDisagrees:false,
    reason:attempts.map(item=>`${item.provider}: ${item.reason || 'indisponível'}`).join(' | ').slice(0,480),
    attempts
  };
}

export const __aiProductImageTreatmentInternals = { bytesToBase64, parseGeminiJson, classifyTasselWithWorkersAi };
