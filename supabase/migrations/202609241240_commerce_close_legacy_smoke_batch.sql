do $$
declare
  v_rows integer;
begin
  update public.commerce_import_batches b
  set status='FAILED',
      completed_at=coalesce(b.completed_at,now())
  where b.id=6
    and b.source_filename='Cópia de ATUAL SHOPEE.xlsx'
    and b.source_sha256='a2975d103a5cf255885b6fc96b172b66775d19fb7132a6f7439c71f0430543bf'
    and b.status='REVIEW'
    and b.row_count=286
    and not exists (
      select 1
      from public.commerce_import_rows r
      where r.batch_id=b.id
        and (r.matched_product_id is not null or r.matched_listing_id is not null)
    );

  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    raise exception using errcode='P0001', message='legacy_smoke_batch_guard_failed';
  end if;
end;
$$;
