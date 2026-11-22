-- =============================================================================
-- FaceO — photo thumbnails
--
-- Each photo may get a small JPEG next to the original in R2:
--   groups/<group>/<uuid>.jpg  ->  groups/<group>/<uuid>.thumb.jpg
-- The thumbnail key is always DERIVED from storage_key (never client-supplied),
-- so a photo row can't be pointed at an arbitrary object.
-- =============================================================================

create or replace function public.thumb_key_for(p_storage_key text)
returns text language sql immutable as $$
  select regexp_replace(p_storage_key, '\.[A-Za-z0-9]+$', '') || '.thumb.jpg'
$$;

alter table public.photos add column if not exists thumb_key text;
alter table public.photos drop constraint if exists photos_thumb_key_derived;
alter table public.photos add constraint photos_thumb_key_derived
  check (thumb_key is null or thumb_key = public.thumb_key_for(storage_key));

-- Photos still needing work (face scan and/or thumbnail)
create index if not exists photos_needs_thumb_idx on public.photos (group_id) where thumb_key is null;

-- Called by the client after it uploaded the thumbnail to the presigned URL.
create or replace function public.set_photo_thumb(p_photo_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_photo public.photos%rowtype;
begin
  select * into v_photo from public.photos where id = p_photo_id;
  if v_photo.id is null or not public.is_group_member(v_photo.group_id) then
    raise exception 'Photo not found' using errcode = 'P0002';
  end if;
  update public.photos set thumb_key = public.thumb_key_for(storage_key) where id = p_photo_id;
  return public.thumb_key_for(v_photo.storage_key);
end $$;

-- get_group_people gains the sample photo's thumbnail (return type changes => drop first)
drop function if exists public.get_group_people(uuid);
create function public.get_group_people(p_group_id uuid)
returns table (
  kind text, user_id uuid, guest_id uuid, name text, avatar_key text,
  photo_count bigint, sample_storage_key text, sample_thumb_key text, sample_box jsonb
)
language sql stable security invoker set search_path = public as $$
  with person_tags as (
    select case when t.user_id is not null then 'member' else 'guest' end as kind,
           t.user_id, t.guest_id, t.photo_id, t.box, t.det_score
    from public.tags t
    where t.group_id = p_group_id and (t.user_id is not null or t.guest_id is not null)
  ),
  agg as (
    select kind, user_id, guest_id, count(distinct photo_id) as photo_count,
           (array_agg(photo_id order by det_score desc nulls last))[1] as sample_photo,
           (array_agg(box      order by det_score desc nulls last))[1] as sample_box
    from person_tags
    group by kind, user_id, guest_id
  )
  select a.kind, a.user_id, a.guest_id,
         coalesce(nullif(u.full_name, ''), eg.display_name, 'Guest ' || eg.guest_number) as name,
         u.avatar_key, a.photo_count, p.storage_key, p.thumb_key, a.sample_box
  from agg a
  left join public.users u         on u.id  = a.user_id
  left join public.event_guests eg on eg.id = a.guest_id
  left join public.photos p        on p.id  = a.sample_photo
  order by (a.kind = 'member') desc, a.photo_count desc;
$$;

revoke execute on function public.thumb_key_for(text)     from public, anon;
revoke execute on function public.set_photo_thumb(uuid)   from public, anon;
revoke execute on function public.get_group_people(uuid)  from public, anon;
grant  execute on function public.thumb_key_for(text)     to authenticated;
grant  execute on function public.set_photo_thumb(uuid)   to authenticated;
grant  execute on function public.get_group_people(uuid)  to authenticated;
