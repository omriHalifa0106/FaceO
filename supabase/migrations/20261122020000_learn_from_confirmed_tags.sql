-- =============================================================================
-- FaceO — learn from confirmed tags
--
-- Until now a member was matched only against their enrollment selfie average.
-- From here on, every face a member confirmed AS THEMSELVES (manual tag they
-- made, or a guest they identified as themselves) is also used as a reference.
-- Missed angles / lighting / glasses get picked up after one correction.
--
-- Safety:
--   * only self-confirmed tags (source = 'manual' and assigned_by = user_id),
--     so someone else's mistaken tag can't teach the matcher a wrong face
--   * only while the member has given biometric consent
--   * "Hide me" still wins (hidden photos are never re-tagged)
--   * references never leave the database (SECURITY DEFINER only)
-- =============================================================================

-- All face references usable for a group's members:
--   enrollment embedding + self-confirmed tag embeddings (from any group).
-- p_exclude_photo: ignore references taken from the photo being processed.
create or replace function public.member_face_references(p_group_id uuid, p_exclude_photo uuid default null)
returns table (user_id uuid, embedding extensions.vector(128))
language sql stable security definer set search_path = public, extensions as $$
  select ufe.user_id, ufe.embedding
    from public.user_face_embeddings ufe
    join public.group_members gm on gm.user_id = ufe.user_id and gm.group_id = p_group_id
  union all
  select t.user_id, te.embedding
    from public.tags t
    join public.tag_embeddings te on te.tag_id = t.id
    join public.group_members gm  on gm.user_id = t.user_id and gm.group_id = p_group_id
    join public.users u           on u.id = t.user_id and u.face_consent_at is not null
   where t.source = 'manual'
     and t.assigned_by = t.user_id
     and (p_exclude_photo is null or t.photo_id <> p_exclude_photo)
$$;

-- The caller's own references (enrollment + self-confirmed faces, consent-gated).
create or replace function public.my_face_references()
returns table (embedding extensions.vector(128))
language sql stable security definer set search_path = public, extensions as $$
  select ufe.embedding from public.user_face_embeddings ufe where ufe.user_id = auth.uid()
  union all
  select te.embedding
    from public.tags t
    join public.tag_embeddings te on te.tag_id = t.id
    join public.users u           on u.id = t.user_id and u.face_consent_at is not null
   where t.user_id = auth.uid()
     and t.source = 'manual'
     and t.assigned_by = auth.uid()
$$;

-- Re-attribute unassigned/guest faces in the caller's groups that are close to
-- ANY of the caller's references. Called after enrollment, joining a group,
-- and whenever the caller confirms a face as themselves.
create or replace function public.resolve_my_guest_tags(p_group_id uuid default null)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid   uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not exists (select 1 from public.my_face_references()) then return 0; end if;

  with refs as materialized (
    select embedding from public.my_face_references()
  ),
  candidates as (
    select t.id, t.photo_id, t.guest_id, d.dist,
           row_number() over (partition by t.photo_id order by d.dist) as rn
    from public.tags t
    join public.tag_embeddings te on te.tag_id = t.id
    join public.group_members gm  on gm.group_id = t.group_id and gm.user_id = v_uid
    cross join lateral (select min(te.embedding <-> r.embedding) as dist from refs r) d
    where t.user_id is null
      and not exists (select 1 from public.photo_hide_requests h where h.photo_id = t.photo_id and h.user_id = v_uid)
      and (p_group_id is null or t.group_id = p_group_id)
      and d.dist < public.face_match_threshold()
  ),
  -- at most one face per photo, and never if the user is already in that photo
  chosen as (
    select c.* from candidates c
    where c.rn = 1
      and not exists (select 1 from public.tags x where x.photo_id = c.photo_id and x.user_id = v_uid)
  ),
  upd as (
    update public.tags t
       set user_id = v_uid, guest_id = null, match_distance = c.dist, source = 'auto'
      from chosen c
     where t.id = c.id
    returning c.guest_id
  )
  select count(*) into v_count from upd;

  -- drop guests that no longer own any face
  delete from public.event_guests eg
   where eg.group_id in (select group_id from public.group_members where user_id = v_uid)
     and (p_group_id is null or eg.group_id = p_group_id)
     and not exists (select 1 from public.tags t where t.guest_id = eg.id);

  return v_count;
end $$;

-- -----------------------------------------------------------------------------
-- Matching / tagging functions updated to use the references above
-- -----------------------------------------------------------------------------

create or replace function public.ingest_photo_faces(p_photo_id uuid, p_faces jsonb)
returns table (tag_id uuid, user_id uuid, guest_id uuid, box jsonb, match_distance real)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_uid        uuid := auth.uid();
  v_group_id   uuid;
  v_face       jsonb;
  v_emb        vector(128);
  v_threshold  real := public.face_match_threshold();
  v_match_user uuid;
  v_match_guest uuid;
  v_dist       real;
  v_tag_id     uuid;
  v_used_users uuid[] := '{}';
  v_hidden     boolean;
  v_count      int := 0;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;

  select p.group_id into v_group_id from public.photos p where p.id = p_photo_id;
  if v_group_id is null or not public.is_group_member(v_group_id) then
    raise exception 'Photo not found' using errcode = 'P0002';
  end if;

  if jsonb_typeof(p_faces) <> 'array' then
    raise exception 'faces must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_faces) > 100 then
    raise exception 'Too many faces in one photo (max 100)' using errcode = '22023';
  end if;

  -- Serialise ingestion per group so guest numbering / clustering is consistent
  perform pg_advisory_xact_lock(hashtextextended(v_group_id::text, 0));

  -- Idempotent re-processing: replace previous automatic tags for this photo
  delete from public.tags t where t.photo_id = p_photo_id and t.source = 'auto';
  select coalesce(array_agg(t.user_id), '{}') into v_used_users
    from public.tags t where t.photo_id = p_photo_id and t.user_id is not null;

  -- Use HNSW iterative scans when available (pgvector >= 0.8) so filtered
  -- nearest-neighbour queries don't come back empty.
  begin
    perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  exception when others then
    null;  -- older pgvector: exact filtering still works, just without the hint
  end;

  for v_face in select * from jsonb_array_elements(p_faces) loop
    if jsonb_typeof(v_face -> 'embedding') <> 'array'
       or jsonb_array_length(v_face -> 'embedding') <> 128 then
      raise exception 'Each face needs a 128-number embedding' using errcode = '22023';
    end if;
    if jsonb_typeof(v_face -> 'box') <> 'object' then
      raise exception 'Each face needs a box' using errcode = '22023';
    end if;

    v_emb := (v_face ->> 'embedding')::vector(128);
    v_match_user := null; v_match_guest := null; v_dist := null;

    -- 1) group members: enrolled reference face OR any face they confirmed
    --    as themselves (see public.member_face_references)
    select r.user_id, r.dist::real,
           exists (select 1 from public.photo_hide_requests h where h.photo_id = p_photo_id and h.user_id = r.user_id)
      into v_match_user, v_dist, v_hidden
      from (
        select ref.user_id, ref.embedding <-> v_emb as dist
          from public.member_face_references(v_group_id, p_photo_id) ref
      ) r
     where not (r.user_id = any (v_used_users))
     order by r.dist
     limit 1;

    -- This person asked not to be tagged in this photo: store nothing about
    -- their face here (no tag, no embedding, no guest).
    if v_match_user is not null and v_dist < v_threshold and v_hidden then
      continue;
    end if;

    if v_match_user is null or v_dist >= v_threshold then
      v_match_user := null;

      -- 2) existing guests in this group
      select t.guest_id, (te.embedding <-> v_emb)::real
        into v_match_guest, v_dist
        from public.tag_embeddings te
        join public.tags t on t.id = te.tag_id
       where te.group_id = v_group_id and t.guest_id is not null
       order by te.embedding <-> v_emb
       limit 1;

      if v_match_guest is null or v_dist >= v_threshold then
        -- 3) new guest
        insert into public.event_guests (group_id, guest_number)
        values (v_group_id,
                coalesce((select max(guest_number) from public.event_guests where group_id = v_group_id), 0) + 1)
        returning id into v_match_guest;
        v_dist := null;
      end if;
    else
      v_used_users := v_used_users || v_match_user;
    end if;

    insert into public.tags (photo_id, group_id, user_id, guest_id, box, det_score, match_distance, source, assigned_by)
    values (p_photo_id, v_group_id, v_match_user, v_match_guest,
            v_face -> 'box', nullif(v_face ->> 'score', '')::real, v_dist, 'auto', v_uid)
    returning id into v_tag_id;

    insert into public.tag_embeddings (tag_id, group_id, embedding)
    values (v_tag_id, v_group_id, v_emb);

    v_count := v_count + 1;
  end loop;

  update public.photos
     set face_status = 'done',
         face_count = (select count(*) from public.tags t where t.photo_id = p_photo_id),
         processed_at = now()
   where id = p_photo_id;

  -- remove guests orphaned by the re-processing above
  delete from public.event_guests eg
   where eg.group_id = v_group_id
     and not exists (select 1 from public.tags t where t.guest_id = eg.id);

  return query
    select t.id, t.user_id, t.guest_id, t.box, t.match_distance
      from public.tags t where t.photo_id = p_photo_id
     order by t.created_at;
end $$;

create or replace function public.merge_guest(p_guest_id uuid, p_user_id uuid default null, p_into_guest_id uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_group_id uuid; v_count int;
begin
  if (p_user_id is null) = (p_into_guest_id is null) then
    raise exception 'Provide exactly one merge target' using errcode = '22023';
  end if;

  select group_id into v_group_id from public.event_guests where id = p_guest_id;
  if v_group_id is null or not public.is_group_member(v_group_id) then
    raise exception 'Guest not found' using errcode = 'P0002';
  end if;

  if p_user_id is not null then
    if not exists (select 1 from public.group_members where group_id = v_group_id and user_id = p_user_id) then
      raise exception 'That user is not a member of this group' using errcode = '22023';
    end if;
    -- photos already containing the user keep the face as unassigned
    update public.tags t set guest_id = null, source = 'manual', assigned_by = auth.uid()
     where t.guest_id = p_guest_id
       and (exists (select 1 from public.tags x where x.photo_id = t.photo_id and x.user_id = p_user_id)
            or exists (select 1 from public.photo_hide_requests h where h.photo_id = t.photo_id and h.user_id = p_user_id));
    update public.tags set user_id = p_user_id, guest_id = null, source = 'manual',
                           match_distance = null, assigned_by = auth.uid()
     where guest_id = p_guest_id;
  else
    if p_into_guest_id = p_guest_id
       or not exists (select 1 from public.event_guests where id = p_into_guest_id and group_id = v_group_id) then
      raise exception 'Invalid target guest' using errcode = '22023';
    end if;
    update public.tags set guest_id = p_into_guest_id, source = 'manual', assigned_by = auth.uid()
     where guest_id = p_guest_id;
  end if;
  get diagnostics v_count = row_count;

  delete from public.event_guests where id = p_guest_id;

  -- Identifying a guest as myself teaches the matcher: re-check the group's
  -- other unassigned faces against my (now larger) set of references.
  if p_user_id = auth.uid() then
    perform public.resolve_my_guest_tags(v_group_id);
  end if;
  return v_count;
end $$;

-- return type changes (void -> integer) => drop first
drop function if exists public.assign_tag(uuid, uuid, uuid);
create function public.assign_tag(p_tag_id uuid, p_user_id uuid default null, p_guest_id uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_tag public.tags%rowtype;
begin
  if p_user_id is not null and p_guest_id is not null then
    raise exception 'Choose a member or a guest, not both' using errcode = '22023';
  end if;

  select * into v_tag from public.tags where id = p_tag_id;
  if v_tag.id is null or not public.is_group_member(v_tag.group_id) then
    raise exception 'Tag not found' using errcode = 'P0002';
  end if;

  if p_user_id is not null then
    if not exists (select 1 from public.group_members where group_id = v_tag.group_id and user_id = p_user_id) then
      raise exception 'That user is not a member of this group' using errcode = '22023';
    end if;
    if exists (select 1 from public.photo_hide_requests h where h.photo_id = v_tag.photo_id and h.user_id = p_user_id) then
      raise exception 'This person asked not to be tagged in this photo' using errcode = '42501';
    end if;
    if exists (select 1 from public.tags where photo_id = v_tag.photo_id and user_id = p_user_id and id <> p_tag_id) then
      raise exception 'That person is already tagged in this photo' using errcode = '23505';
    end if;
  end if;

  if p_guest_id is not null
     and not exists (select 1 from public.event_guests where id = p_guest_id and group_id = v_tag.group_id) then
    raise exception 'Guest not found in this group' using errcode = '22023';
  end if;

  update public.tags
     set user_id = p_user_id, guest_id = p_guest_id, source = 'manual',
         match_distance = null, assigned_by = auth.uid()
   where id = p_tag_id;

  delete from public.event_guests eg
   where eg.id = v_tag.guest_id
     and not exists (select 1 from public.tags t where t.guest_id = eg.id);

  -- Tagging myself teaches the matcher; return how many more faces it found.
  if p_user_id is not null and p_user_id = auth.uid() then
    return public.resolve_my_guest_tags(v_tag.group_id);
  end if;
  return 0;
end $$;

-- Internal helpers: never callable from the client.
revoke execute on function public.member_face_references(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.my_face_references()               from public, anon, authenticated;

revoke execute on function public.assign_tag(uuid, uuid, uuid)       from public, anon;
grant  execute on function public.assign_tag(uuid, uuid, uuid)       to authenticated;
grant  execute on function public.resolve_my_guest_tags(uuid)        to authenticated;
