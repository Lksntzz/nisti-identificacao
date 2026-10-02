const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
const DEFAULT_GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_TRANSIENT_STATUSES = new Set([408,429,500,502,503,504]);
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

function sleep(ms) {
  return new Promise(resolve=>setTimeout(resolve,ms));
}

async function requestGeminiTasselClassification(bytes, contentType, env, model) {
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
        generationConfig:{
          responseMimeType:'application/json',
          responseSchema:{
            type:'OBJECT',
            properties:{
              has_tassel:{type:'BOOLEAN'},
              confidence:{type:'NUMBER',minimum:0,maximum:1},
              reason:{type:'STRING'}
            },
            required:['has_tassel','confidence','reason']
          },
          thinkingConfig:{thinkingLevel:'minimal'},
          maxOutputTokens:1024
        }
      })
    }
  );

  if (!response.ok) {
    let detail='';
    try {
      const errorPayload=await response.json();
      detail=String(errorPayload?.error?.message || errorPayload?.error?.status || '').trim();
    } catch {}
    const error=new Error(`Gemini ${model} respondeu HTTP ${response.status}${detail ? `: ${detail}` : '.'}`);
    error.status=response.status;
    error.transient=GEMINI_TRANSIENT_STATUSES.has(response.status);
    throw error;
  }

  const payload=await response.json();
  const text=payload?.candidates?.[0]?.content?.parts?.map(part=>part?.text || '').join('') || '';
  const parsed=parseGeminiJson(text);
  if (!parsed || typeof parsed.has_tassel !== 'boolean') {
    const finishReason=String(payload?.candidates?.[0]?.finishReason || '').trim();
    const detail=finishReason ? ` (finishReason: ${finishReason})` : '';
    throw new Error(`Gemini ${model} retornou classificação inválida${detail}.`);
  }

  return {
    available:true,
    provider:'gemini',
    model,
    has_tassel:parsed.has_tassel,
    confidence:Math.max(0,Math.min(1,Number(parsed.confidence || 0))),
    reason:String(parsed.reason || '').slice(0,240)
  };
}

async function classifyTasselWithGemini(bytes, contentType, env) {
  if (!env.GEMINI_API_KEY) return { available:false, provider:'gemini', has_tassel:null, confidence:0, reason:'GEMINI_API_KEY ausente.' };

  const primary=String(env.GEMINI_IMAGE_MODEL || DEFAULT_GEMINI_MODEL).trim();
  const fallback=String(env.GEMINI_IMAGE_FALLBACK_MODEL || DEFAULT_GEMINI_FALLBACK_MODEL).trim();
  const models=[...new Set([primary,fallback].filter(Boolean))];
  const errors=[];

  for (let modelIndex=0;modelIndex<models.length;modelIndex+=1) {
    const model=models[modelIndex];
    const maxAttempts=modelIndex===0 ? 3 : 2;

    for (let attempt=1;attempt<=maxAttempts;attempt+=1) {
      try {
        return await requestGeminiTasselClassification(bytes,contentType,env,model);
      } catch(error) {
        errors.push(`${model} tentativa ${attempt}/${maxAttempts}: ${error.message}`);
        if (!error.transient || attempt===maxAttempts) break;
        const baseDelay=attempt===1 ? 700 : 1400;
        const jitter=Math.floor(Math.random()*250);
        await sleep(baseDelay+jitter);
      }
    }
  }

  throw new Error(errors.join(' | ').slice(0,900) || 'Gemini indisponível.');
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
