const SIGNATURE_MODEL_FALLBACK = 'gemini-3.5-flash-lite';
const SIGNATURE_TIMEOUT_MS = 5500;
const DEFAULT_SYNC_LIMIT = 4;
const MAX_SYNC_LIMIT = 8;
let schemaReady = false;

function base64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function cleanText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueStrings(values, limit = 12) {
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = cleanText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

export function normalizeVisualSignature(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    fixed_text: uniqueStrings(source.fixed_text, 10),
    primary_subjects: uniqueStrings(source.primary_subjects, 10),
    graphic_elements: uniqueStrings(source.graphic_elements, 12),
    colors: uniqueStrings(source.colors, 8),
    layout_tokens: uniqueStrings(source.layout_tokens, 10),
    style_tokens: uniqueStrings(source.style_tokens, 8)
  };
}

function parseStructuredJson(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  const text = (Array.isArray(parts) ? parts : [])
    .map(part => typeof part?.text === 'string' ? part.text : '')
    .join('')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!text) throw new Error('empty_signature_response');
  try {
    return JSON.parse(text);
  } catch {}
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
  throw new Error('invalid_signature_json');
}

function signaturePrompt() {
  return `Analise SOMENTE a arte-base da capa do produto NISTI PRINT e gere uma assinatura visual objetiva.\n\nIGNORE totalmente: nome personalizado da pessoa, inicial/letra personalizada, datas, Wire-O/espiral, elástico, tassel, mão, mesa, reflexo, brilho holográfico, perspectiva e fundo externo do mockup.\n\nEXTRAIA:\n- fixed_text: textos que fazem parte permanentemente da arte. Ex.: \"caderneta de saude\". NÃO inclua nomes próprios personalizados como Theo, Bernardo etc.\n- primary_subjects: personagens, animais, objetos ou símbolos centrais. Ex.: \"filhote de leao\", \"esmalte\", \"cruz medica\".\n- graphic_elements: folhas, flores, corações, estrelas, molduras, faixas, linhas, círculos e outros elementos gráficos permanentes.\n- colors: cores dominantes da CAPA e principais cores de destaque. Use nomes simples em português, como verde escuro, dourado, laranja, vinho, preto, branco, azul.\n- layout_tokens: posições estruturais, como titulo topo centro, personagem centro, folhagem laterais, faixa diagonal.\n- style_tokens: estilo visual, como infantil, floral, minimalista, executivo, manicure, safari.\n\nSe um item não estiver visível, retorne lista vazia. Seja conservador e não invente.`;
}

export async function extractVisualSignature(env, bytes, mimeType, options = {}) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');
  const model = options.model || env.GEMINI_MODEL || SIGNATURE_MODEL_FALLBACK;
  const timeoutMs = Math.max(1500, Number(options.timeoutMs || SIGNATURE_TIMEOUT_MS));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('visual-signature-timeout'), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: signaturePrompt() },
              {
                inline_data: {
                  mime_type: mimeType || 'image/jpeg',
                  data: base64(bytes)
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 360,
            media_resolution: 'MEDIA_RESOLUTION_LOW',
            thinkingConfig: { thinkingLevel: 'minimal' },
            response_mime_type: 'application/json',
            response_schema: {
              type: 'OBJECT',
              properties: {
                fixed_text: { type: 'ARRAY', items: { type: 'STRING' } },
                primary_subjects: { type: 'ARRAY', items: { type: 'STRING' } },
                graphic_elements: { type: 'ARRAY', items: { type: 'STRING' } },
                colors: { type: 'ARRAY', items: { type: 'STRING' } },
                layout_tokens: { type: 'ARRAY', items: { type: 'STRING' } },
                style_tokens: { type: 'ARRAY', items: { type: 'STRING' } }
              },
              required: [
                'fixed_text','primary_subjects','graphic_elements',
                'colors','layout_tokens','style_tokens'
              ]
            }
          }
        })
      }
    );
    if (!response.ok) throw new Error(`gemini_signature_http_${response.status}`);
    const parsed = parseStructuredJson(await response.json());
    return {
      model,
      signature: normalizeVisualSignature(parsed),
      elapsed_ms: Date.now() - started
    };
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      const timeout = new Error('visual_signature_timeout');
      timeout.code = 'visual_signature_timeout';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function ensureVisualSignatureSchema(env) {
  if (schemaReady) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS cover_visual_signatures (
      capa_code TEXT PRIMARY KEY,
      reference_id INTEGER,
      signature_model TEXT NOT NULL,
      signature_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (reference_id) REFERENCES cover_visual_references(id) ON DELETE SET NULL
    )
  `).run();
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_cover_visual_signatures_reference
      ON cover_visual_signatures(reference_id)
  `).run();
  schemaReady = true;
}

export async function syncVisualSignatures(env, options = {}) {
  await ensureVisualSignatureSchema(env);
  const limit = Math.max(1, Math.min(MAX_SYNC_LIMIT, Number(options.limit) || DEFAULT_SYNC_LIMIT));
  const { results } = await env.DB.prepare(`
    SELECT r.id,r.capa_code,r.image_key,r.updated_at
    FROM cover_visual_references r
    LEFT JOIN cover_visual_signatures s ON s.capa_code=r.capa_code
    WHERE r.active=1
      AND r.image_key IS NOT NULL
      AND (s.capa_code IS NULL OR s.reference_id<>r.id OR s.updated_at<r.updated_at)
      AND r.id=(
        SELECT MIN(r2.id)
        FROM cover_visual_references r2
        WHERE r2.active=1 AND r2.image_key IS NOT NULL AND r2.capa_code=r.capa_code
      )
    ORDER BY r.id ASC
    LIMIT ?
  `).bind(limit).all();

  const outcomes = await Promise.all((results || []).map(async row => {
    try {
      const object = await env.PRODUCT_IMAGES.get(row.image_key);
      if (!object) throw new Error('reference_image_missing');
      const bytes = new Uint8Array(await object.arrayBuffer());
      const analyzed = await extractVisualSignature(
        env,
        bytes,
        object.httpMetadata?.contentType || 'image/jpeg',
        { timeoutMs: 7000 }
      );
      await env.DB.prepare(`
        INSERT INTO cover_visual_signatures (
          capa_code,reference_id,signature_model,signature_json,updated_at
        ) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(capa_code) DO UPDATE SET
          reference_id=excluded.reference_id,
          signature_model=excluded.signature_model,
          signature_json=excluded.signature_json,
          updated_at=CURRENT_TIMESTAMP
      `).bind(
        String(row.capa_code || '').trim().toUpperCase(),
        Number(row.id),
        analyzed.model,
        JSON.stringify(analyzed.signature)
      ).run();
      return { ok: true, capa_code: row.capa_code, reference_id: Number(row.id) };
    } catch (error) {
      return {
        ok: false,
        capa_code: row.capa_code,
        reference_id: Number(row.id),
        error: error?.message || 'signature_failed'
      };
    }
  }));

  const pending = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM (
      SELECT r.capa_code
      FROM cover_visual_references r
      LEFT JOIN cover_visual_signatures s ON s.capa_code=r.capa_code
      WHERE r.active=1 AND r.image_key IS NOT NULL
      GROUP BY r.capa_code
      HAVING MAX(CASE WHEN s.capa_code IS NOT NULL THEN 1 ELSE 0 END)=0
    )
  `).first();

  return {
    ok: outcomes.every(item => item.ok),
    attempted: outcomes.length,
    updated: outcomes.filter(item => item.ok).length,
    failed: outcomes.filter(item => !item.ok),
    remaining: Number(pending?.total || 0)
  };
}
