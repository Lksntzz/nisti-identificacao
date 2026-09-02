function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function referenceIdFromMatch(match) {
  const id = Number(match?.metadata?.reference_id || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Treat Vectorize as a derived search index only. Any match whose reference_id
 * no longer exists as an active D1 visual reference is discarded. Metadata
 * used by recognition is replaced with the current canonical D1 values.
 */
export async function canonicalizeActiveVectorMatches(env, matches) {
  if (!env?.DB?.prepare) {
    throw new Error('D1 não configurado para validar referências do Vectorize.');
  }

  const source = Array.isArray(matches) ? matches : [];
  const ids = [...new Set(source.map(referenceIdFromMatch).filter(Boolean))];
  if (!ids.length) return [];

  const placeholders = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`
    SELECT id,capa_code,image_key,source_product_id,reference_kind,active
    FROM cover_visual_references
    WHERE active=1 AND id IN (${placeholders})
  `).bind(...ids).all();

  const active = new Map();
  for (const row of results || []) {
    const id = Number(row.id || 0);
    const capaCode = normalizeCode(row.capa_code);
    const imageKey = String(row.image_key || '').trim();
    if (!id || !capaCode || !imageKey) continue;
    active.set(id, {
      reference_id: id,
      capa_code: capaCode,
      image_key: imageKey,
      source_product_id: Number(row.source_product_id || 0) || null,
      reference_kind: String(row.reference_kind || 'product').trim().toLowerCase() || 'product'
    });
  }

  const trusted = [];
  for (const match of source) {
    const id = referenceIdFromMatch(match);
    const reference = id ? active.get(id) : null;
    if (!reference) continue;

    trusted.push({
      ...match,
      metadata: {
        ...(match?.metadata || {}),
        ...reference
      }
    });
  }

  return trusted;
}
