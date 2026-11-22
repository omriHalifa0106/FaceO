-- =============================================================================
-- FaceO — biometric consent + "hide me"
--
-- Consent: a face embedding can only exist while users.face_consent_at is set
-- (enforced by trigger, not just the UI). Withdrawing consent deletes it.
--
-- Hide me: a recognised person can remove themselves from a photo. Their tag
-- (and the face embedding for it) is deleted, they can't be re-tagged there
-- automatically or manually, and the uploader + group admins see a removal
-- request they can act on by deleting the photo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Consent
-- -----------------------------------------------------------------------------
alter table public.users add column if not exists face_consent_at      timestamptz;
alter table public.users add column if not exists face_consent_version text
  check (face_consent_version is null or char_length(face_consent_version) <= 40);

create or replace function public.require_face_consent()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users u where u.id = new.user_id and u.face_consent_at is not null) then
    raise exception 'Consent to biometric processing is required before saving a face profile'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists user_face_embeddings_require_consent on public.user_face_embeddings;
create trigger user_face_embeddings_require_consent
  before insert or update on public.user_face_embeddings
  for each row execute function public.require_face_consent();

create or replace function public.give_face_consent(p_version text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_at timestamptz := now();
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if p_version is null or btrim(p_version) = '' then
    raise exception 'Consent version is required' using errcode = '22023';
  end if;
  update public.users set face_consent_at = v_at, face_consent_version = left(btrim(p_version), 40)
   where id = auth.uid();
  return v_at;
end $$;

-- Withdraw consent: delete the reference face and forget the consent.
-- Existing tags stay (group content); no new automatic matches are possible.
create or replace function public.withdraw_face_consent()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  delete from public.user_face_embeddings where user_id = auth.uid();
  update public.users set face_consent_at = null, face_consent_version = null where id = auth.uid();
end $$;

-- -----------------------------------------------------------------------------
-- Hide me
-- -----------------------------------------------------------------------------
create table if not exists public.photo_hide_requests (
  photo_id   uuid not null references public.photos(id) on delete cascade,
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references public.users(id)  on delete cascade,
  created_at timestamptz not null default now(),
  primary key (photo_id, user_id)
);
create index if not exists photo_hide_requests_group_idx on public.photo_hide_requests (group_id);
create index if not exists photo_hide_requests_user_idx  on public.photo_hide_requests (user_id);

alter table public.photo_hide_requests enable row level security;
drop policy if exists phr_select on public.photo_hide_requests;
-- visible to the requester, the photo's uploader and group admins
create policy phr_select on public.photo_hide_requests for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_group_admin(group_id)
    or exists (select 1 from public.photos p where p.id = photo_id and p.uploaded_by = auth.uid())
  );
revoke all on public.photo_hide_requests from anon;
revoke insert, update, delete on public.photo_hide_requests from authenticated;

create or replace function public.hide_me_in_photo(p_photo_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_group_id uuid; v_removed int;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select group_id into v_group_id from public.photos where id = p_photo_id;
  if v_group_id is null or not public.is_group_member(v_group_id) then
    raise exception 'Photo not found' using errcode = 'P0002';
  end if;

  insert into public.photo_hide_requests (photo_id, group_id, user_id)
  values (p_photo_id, v_group_id, auth.uid())
  on conflict do nothing;

  -- removing the tag also removes that face's embedding (FK cascade)
  delete from public.tags where photo_id = p_photo_id and user_id = auth.uid();
  get diagnostics v_removed = row_count;

  update public.photos
     set face_count = (select count(*) from public.tags where photo_id = p_photo_id)
   where id = p_photo_id;
  return v_removed;
end $$;

-- Withdraw the request (you may be re-tagged on the next scan).
create or replace function public.unhide_me_in_photo(p_photo_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  delete from public.photo_hide_requests where photo_id = p_photo_id and user_id = auth.uid();
end $$;

-- -----------------------------------------------------------------------------
-- Matching functions: respect hide requests
--   ingest_photo_faces    - a hidden person's face is skipped entirely
--   resolve_my_guest_tags - never re-attributes faces in photos I hid from
--   assign_tag / merge_guest - can't (re)tag someone who hid from a photo
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

    -- 1) group members with an enrolled face
    select ufe.user_id, (ufe.embedding <-> v_emb)::real,
           exists (select 1 from public.photo_hide_requests h where h.photo_id = p_photo_id and h.user_id = ufe.user_id)
      into v_match_user, v_dist, v_hidden
      from public.user_face_embeddings ufe
      join public.group_members gm on gm.user_id = ufe.user_id and gm.group_id = v_group_id
     where not (ufe.user_id = any (v_used_users))
     order by ufe.embedding <-> v_emb
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

create or replace function public.resolve_my_guest_tags(p_group_id uuid default null)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid       uuid := auth.uid();
  v_embedding vector(128);
  v_count     integer;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;

  select embedding into v_embedding from public.user_face_embeddings where user_id = v_uid;
  if v_embedding is null then return 0; end if;

  with candidates as (
    select t.id, t.photo_id, t.guest_id,
           te.embedding <-> v_embedding as dist,
           row_number() over (partition by t.photo_id
                              order by te.embedding <-> v_embedding) as rn
    from public.tags t
    join public.tag_embeddings te on te.tag_id = t.id
    join public.group_members gm  on gm.group_id = t.group_id and gm.user_id = v_uid
    where t.user_id is null
      and not exists (select 1 from public.photo_hide_requests h where h.photo_id = t.photo_id and h.user_id = v_uid)
      and (p_group_id is null or t.group_id = p_group_id)
      and te.embedding <-> v_embedding < public.face_match_threshold()
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

create or replace function public.assign_tag(p_tag_id uuid, p_user_id uuid default null, p_guest_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
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
  return v_count;
end $$;

revoke execute on function public.require_face_consent()       from public, anon;
revoke execute on function public.give_face_consent(text)      from public, anon;
revoke execute on function public.withdraw_face_consent()      from public, anon;
revoke execute on function public.hide_me_in_photo(uuid)       from public, anon;
revoke execute on function public.unhide_me_in_photo(uuid)     from public, anon;
grant  execute on function public.give_face_consent(text)      to authenticated;
grant  execute on function public.withdraw_face_consent()      to authenticated;
grant  execute on function public.hide_me_in_photo(uuid)       to authenticated;
grant  execute on function public.unhide_me_in_photo(uuid)     to authenticated;
