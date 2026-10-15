-- Operator-safe lookup for a single post opened from a Mural push notification.
-- Includes only published, currently visible posts; never returns drafts or expired data.
create or replace function public.nisti_mural_notification_post_v1(
  p_post_id bigint, p_user_id text
) returns jsonb language sql stable set search_path='public' as $$
select to_jsonb(row) from (
  select mp.id,mp.kind,mp.title,mp.subtitle,mp.body,mp.badge,mp.badge_tone,
    mp.featured,mp.priority,mp.published_at,mp.expires_at,mp.image_key,mp.notice_level,
    p.id as product_id,p.sku,p.miolo_code,p.nome as product_name,
    p.wireo_code,p.tassel_code,p.elastico_code,p.image_key as product_image_key,
    mpi.status as mural_image_status,mpi.reviewed_by as mural_image_reviewed_by,
    mpi.source_image_key as mural_source_image_key,
    mpi.processed_image_key as mural_processed_image_key,
    mpi.processor_version as mural_image_processor_version,
    mc.id as collection_id,mc.slug as collection_slug,mc.name as collection_name,
    mc.year as collection_year,mc.show_year as collection_show_year,
    mc.hero_message as collection_hero_message,mc.visual_direction as collection_visual_direction,
    mc.theme_notes as collection_theme_notes,mc.description as collection_description,
    mc.image_key as collection_image_key,
    case when mr.post_id is null then 0 else 1 end as is_read
  from public.mural_posts mp
  left join public.products p on p.id=mp.product_id
  left join public.mural_product_images mpi on mpi.product_id=p.id
  left join public.mural_collections mc on mc.id=mp.collection_id
  left join public.mural_post_reads mr on mr.post_id=mp.id and mr.user_id=p_user_id
  where mp.id=p_post_id and mp.status='published'
    and mp.published_at is not null and mp.published_at<=now()
    and (mp.expires_at is null or mp.expires_at>now())
  limit 1
) row;
$$;
revoke execute on function public.nisti_mural_notification_post_v1(bigint,text) from public,anon,authenticated;
grant execute on function public.nisti_mural_notification_post_v1(bigint,text) to service_role;
