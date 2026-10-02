const DEFAULT_BACKGROUND_MODEL = '@cf/briaai/rmbg-1.4';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function parseGeminiJson(text) {
  const normalized = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = normalized.indexOf('{');
  const end = normalized.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(normalized.slice(start, end + 1)); } catch { return null; }
}

async function classifyTasselWithGemini(bytes, contentType, env) {
  if (!env.GEMINI_API_KEY) return { available:false, has_tassel:null, confidence:0 };
  const model = String(env.GEMINI_IMAGE_MODEL || DEFAULT_GEMINI_MODEL).trim();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method:'POST',
      headers:{ 'content-type':'application/json', 'x-goog-api-key':env.GEMINI_API_KEY },
      body:JSON.stringify({
        contents:[{ parts:[
          { text:'Analise somente o produto principal. Responda JSON puro: {"has_tassel":boolean,"confidence":number,"reason":string}. Tassel é o pingente de fios preso à agenda; não confunda wire-o, elástico, sombra ou decoração impressa com tassel.' },
          { inlineData:{ mimeType:contentType || 'image/jpeg', data:bytesToBase64(bytes) } }
        ] }],
        generationConfig:{ responseMimeType:'application/json', temperature:0, maxOutputTokens:160 }
      })
    }
  );
  if (!response.ok) throw new Error(`Gemini não conseguiu analisar o tassel (${response.status}).`);
  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map(part=>part?.text || '').join('') || '';
  const parsed = parseGeminiJson(text);
  if (!parsed || typeof parsed.has_tassel !== 'boolean') throw new Error('Gemini retornou uma classificação de tassel inválida.');
  return {
    available:true,
    has_tassel:parsed.has_tassel,
    confidence:Math.max(0,Math.min(1,Number(parsed.confidence || 0))),
    reason:String(parsed.reason || '').slice(0,240)
  };
}

async function backgroundRemovalBytes(result) {
  if (result instanceof Response) return new Uint8Array(await result.arrayBuffer());
  if (result instanceof Blob) return new Uint8Array(await result.arrayBuffer());
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (ArrayBuffer.isView(result)) return new Uint8Array(result.buffer,result.byteOffset,result.byteLength);
  if (typeof ReadableStream !== 'undefined' && result instanceof ReadableStream) {
    return new Uint8Array(await new Response(result).arrayBuffer());
  }
  if (typeof result === 'string') {
    const encoded=result.replace(/^data:image\/[^;]+;base64,/i,'');
    const binary=atob(encoded);
    return Uint8Array.from(binary,char=>char.charCodeAt(0));
  }
  if (typeof result?.image === 'string') {
    const encoded=result.image.replace(/^data:image\/[^;]+;base64,/i,'');
    const binary=atob(encoded);
    return Uint8Array.from(binary,char=>char.charCodeAt(0));
  }
  throw new Error('Workers AI não retornou uma imagem tratada válida.');
}

export async function generateAiProductCutout(imageObject, tasselCode, env) {
  if (!env.AI?.run) throw new Error('Workers AI não está configurado para o tratamento de imagens.');
  const bytes = new Uint8Array(await imageObject.arrayBuffer());
  const contentType = imageObject.httpMetadata?.contentType || 'image/jpeg';
  const registeredHasTassel = String(tasselCode || '').trim().toUpperCase() !== 'X';

  const geminiPromise = classifyTasselWithGemini(bytes,contentType,env).catch(error=>({
    available:false,has_tassel:null,confidence:0,reason:error.message
  }));
  const model = String(env.AI_BACKGROUND_REMOVAL_MODEL || DEFAULT_BACKGROUND_MODEL).trim();
  const cutoutResult = await env.AI.run(model,{ image:Array.from(bytes) });
  const [cutout,gemini] = await Promise.all([backgroundRemovalBytes(cutoutResult),geminiPromise]);
  if (cutout.length < 32) throw new Error('Workers AI retornou uma imagem tratada vazia.');

  const confidentGemini = gemini.available && gemini.confidence >= .7;
  return {
    bytes:cutout,
    registeredHasTassel,
    detectedHasTassel:confidentGemini ? gemini.has_tassel : null,
    tasselDisagrees:confidentGemini && gemini.has_tassel !== registeredHasTassel,
    gemini
  };
}

export const __aiProductImageTreatmentInternals = { bytesToBase64, parseGeminiJson, backgroundRemovalBytes };
