import { mirrorSupabaseRpc } from './supabase-write-store.js';
import { recordAdminSystemNotification } from './system-notifications.js';

// Rascunho automatico no Mural: produto novo + imagem tratada aprovada + EAN valido.
// Nunca publica sozinho e nunca bloqueia a acao que o disparou (falhas so vao para o log).
const MAX_EDITORIAL_IMAGE_BYTES = 5 * 1024 * 1024;

export async function createEanAnnouncementDraft(env, productId) {
  const id = Number(productId);
  if (!Number.isInteger(id) || id <= 0 || !env?.PRODUCT_IMAGES) return { status: 'skipped' };

  const draft = (await mirrorSupabaseRpc(env, 'nisti_mural_ean_draft_v1',
    { p_product_id: id }, 'rascunho de aviso de EAN')).value || {};
  if (draft.status !== 'created') return { status: draft.status || 'skipped' };

  const postId = Number(draft.post_id);
  let imageStatus = 'ok';
  let newKey = null;
  try {
    // COPIA a imagem tratada: o Mural apaga a chave antiga ao trocar, entao nunca referenciamos a do produto.
    const source = await env.PRODUCT_IMAGES.get(draft.processed_image_key);
    if (!source) throw new Error('imagem tratada nao encontrada');
    const bytes = await source.arrayBuffer();
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_EDITORIAL_IMAGE_BYTES) throw new Error('imagem acima de 5 MB');
    newKey = `mural/posts/${postId}/${crypto.randomUUID()}`;
    await env.PRODUCT_IMAGES.put(newKey, bytes, { httpMetadata: { contentType: 'image/png' } });
    const saved = (await mirrorSupabaseRpc(env, 'nisti_admin_mural_editorial_image_v1',
      { p_owner: 'posts', p_id: postId, p_image_key: newKey }, `mural posts image ${postId}`)).value || {};
    if (saved.status !== 'ok') throw new Error('nao foi possivel salvar a imagem');
  } catch (error) {
    imageStatus = 'failed';
    console.error('Falha ao anexar imagem ao rascunho de EAN.', error);
    if (newKey) await env.PRODUCT_IMAGES.delete(newKey).catch(() => {});
  }

  await recordAdminSystemNotification(env, {
    event_type: 'mural_ean_draft',
    entity_id: String(id),
    title: 'Rascunho de aviso de EAN no Mural',
    message: imageStatus === 'ok'
      ? `Rascunho pronto para revisar no Mural (produto #${id}).`
      : `Rascunho criado no Mural (produto #${id}), mas sem imagem: anexe uma ao revisar.`,
    request_path: '/api/mural'
  }).catch(() => {});

  return { status: 'created', post_id: postId, image: imageStatus };
}

export function scheduleEanAnnouncementDraft(ctx, env, productId) {
  const task = createEanAnnouncementDraft(env, productId).catch(error => {
    console.error('Falha ao criar rascunho de aviso de EAN.', error);
  });
  if (ctx?.waitUntil) ctx.waitUntil(task);
  return task;
}
