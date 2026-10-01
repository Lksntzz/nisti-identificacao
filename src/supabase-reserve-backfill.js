import { supabaseRpc } from './supabase-read-store.js';

const BATCH_SIZE = 100;
const STREAMS = Object.freeze([
  'gtin_scan_events',
  'mural_collections',
  'mural_posts',
  'mural_collection_products',
  'mural_post_reads'
]);

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

async function streamState(env, stream) {
  const value = await supabaseRpc(env, 'nisti_reserve_stream_state_v1', { p_stream: stream });
  const state = Array.isArray(value) ? value[0] : null;
  return {
    stream,
    last_numeric:Number(state?.last_numeric || 0),
    last_text:String(state?.last_text || ''),
    complete:state?.complete === true
  };
}

async function checkpoint(env, stream, lastNumeric, lastText, complete) {
  await supabaseRpc(env, 'nisti_reserve_stream_checkpoint_v1', {
    p_stream:stream,
    p_last_numeric:Number(lastNumeric || 0),
    p_last_text:String(lastText || '') || null,
    p_complete:Boolean(complete)
  });
}

function isMissingTable(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('no such table') || message.includes('does not exist');
}

async function syncGtinEvents(env) {
  const state = await streamState(env, 'gtin_scan_events');
  if (state.complete) return { stream:state.stream, skipped:true, complete:true };

  let batch;
  try {
    batch = await env.DB.prepare(`
      SELECT
        id,gtin,status,product_id,operator_name,operator_id,response_ms,error_code,
        created_at,dismissed_at,dismissed_by
      FROM gtin_scan_events
      WHERE id>?
      ORDER BY id ASC
      LIMIT ?
    `).bind(state.last_numeric,BATCH_SIZE).all();
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    await checkpoint(env,state.stream,state.last_numeric,state.last_text,true);
    return { stream:state.stream, copied:0, complete:true, empty:true };
  }

  const data=rows(batch);
  if (data.length) {
    await supabaseRpc(env,'nisti_mirror_gtin_scan_events_batch_v1',{ p_rows:data });
  }
  const last=data[data.length-1];
  const complete=data.length < BATCH_SIZE;
  await checkpoint(env,state.stream,last?.id ?? state.last_numeric,'',complete);
  return { stream:state.stream, copied:data.length, complete };
}

async function syncIdStream(env, stream, table, columns, rpcName) {
  const state=await streamState(env,stream);
  if (state.complete) return { stream, skipped:true, complete:true };

  const batch=await env.DB.prepare(`
    SELECT ${columns}
    FROM ${table}
    WHERE id>?
    ORDER BY id ASC
    LIMIT ?
  `).bind(state.last_numeric,BATCH_SIZE).all();

  const data=rows(batch);
  if (data.length) await supabaseRpc(env,rpcName,{ p_rows:data });
  const last=data[data.length-1];
  const complete=data.length < BATCH_SIZE;
  await checkpoint(env,stream,last?.id ?? state.last_numeric,'',complete);
  return { stream, copied:data.length, complete };
}

async function syncCompositeStream(env, stream, table, columns, numericColumn, textColumn, rpcName) {
  const state=await streamState(env,stream);
  if (state.complete) return { stream, skipped:true, complete:true };

  const lastTextNumber=Number(state.last_text || 0);
  const batch=await env.DB.prepare(`
    SELECT ${columns}
    FROM ${table}
    WHERE ${numericColumn}>?
       OR (${numericColumn}=? AND ${textColumn}>?)
    ORDER BY ${numericColumn} ASC,${textColumn} ASC
    LIMIT ?
  `).bind(state.last_numeric,state.last_numeric,lastTextNumber,BATCH_SIZE).all();

  const data=rows(batch);
  if (data.length) await supabaseRpc(env,rpcName,{ p_rows:data });
  const last=data[data.length-1];
  const complete=data.length < BATCH_SIZE;
  await checkpoint(
    env,
    stream,
    last?.[numericColumn] ?? state.last_numeric,
    last ? String(last[textColumn] ?? '') : state.last_text,
    complete
  );
  return { stream, copied:data.length, complete };
}

async function syncPostReads(env) {
  const state=await streamState(env,'mural_post_reads');
  if (state.complete) return { stream:state.stream, skipped:true, complete:true };

  const batch=await env.DB.prepare(`
    SELECT post_id,user_id,read_at
    FROM mural_post_reads
    WHERE post_id>?
       OR (post_id=? AND user_id>?)
    ORDER BY post_id ASC,user_id ASC
    LIMIT ?
  `).bind(state.last_numeric,state.last_numeric,state.last_text || '',BATCH_SIZE).all();

  const data=rows(batch);
  if (data.length) {
    await supabaseRpc(env,'nisti_mirror_mural_post_reads_batch_v1',{ p_rows:data });
  }
  const last=data[data.length-1];
  const complete=data.length < BATCH_SIZE;
  await checkpoint(
    env,
    state.stream,
    last?.post_id ?? state.last_numeric,
    last?.user_id ?? state.last_text,
    complete
  );
  return { stream:state.stream, copied:data.length, complete };
}

export async function runReserveBackfill(env) {
  const result=[];
  const jobs=[
    () => syncGtinEvents(env),
    () => syncIdStream(
      env,
      'mural_collections',
      'mural_collections',
      'id,slug,name,year,description,image_key,status,created_at,updated_at',
      'nisti_mirror_mural_collections_batch_v1'
    ),
    () => syncIdStream(
      env,
      'mural_posts',
      'mural_posts',
      'id,kind,status,title,subtitle,body,badge,badge_tone,image_key,product_id,collection_id,notice_level,featured,priority,published_at,expires_at,created_by,created_at,updated_at',
      'nisti_mirror_mural_posts_batch_v1'
    ),
    () => syncCompositeStream(
      env,
      'mural_collection_products',
      'mural_collection_products',
      'collection_id,product_id,sort_order',
      'collection_id',
      'product_id',
      'nisti_mirror_mural_collection_products_batch_v1'
    ),
    () => syncPostReads(env)
  ];

  for (const job of jobs) {
    try {
      result.push(await job());
    } catch (error) {
      console.warn('[Supabase reserve backfill] stream pendente', {
        message:error?.message || String(error)
      });
      result.push({ error:error?.message || String(error) });
    }
  }

  return {
    ok:result.every(item => !item.error),
    streams:result,
    expected_streams:[...STREAMS]
  };
}
