-- =============================================================================
-- FaceO — full database schema
--
-- Run once in the Supabase SQL Editor (or `supabase db push`).
--
-- Design notes
--   * auth.users  = Supabase identity (email/password).  public.users = app
--     profile, 1:1 with auth.users, created by trigger.
--   * Biometric vectors live ONLY in two tables:
--       - public.user_face_embeddings  (owner-only RLS)
--       - public.tag_embeddings        (no client access at all)
--     All matching happens inside SECURITY DEFINER functions, so no client
--     ever receives another person's embedding.
--   * Embeddings are 128-d descriptors from @vladmandic/face-api, compared
--     with Euclidean (L2) distance.
--   * Photo files live in Cloudflare R2; the DB stores only the object key.
-- =============================================================================

create extension if not exists vector   with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Tunables
-- -----------------------------------------------------------------------------

-- L2 distance below which two face descriptors are considered the same person.
-- face-api's usual value is 0.6; 0.5 trades a few missed matches for fewer
-- false positives (a wrong person in someone's gallery is the worse failure).
create or replace function public.face_match_threshold()
returns real language sql immutable as $$ select 0.5::real $$;

-- -----------------------------------------------------------------------------
-- Generic updated_at trigger
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- =============================================================================
-- Tables
-- =============================================================================

-- Profiles --------------------------------------------------------------------
create table public.users (
  id               uuid primary key references auth.users(id) on delete cascade,
  full_name        text not null default '' check (char_length(full_name) <= 100),
  phone            text check (phone is null or char_length(phone) <= 32),
  avatar_key       text,
  face_enrolled_at timestamptz,                      -- non-biometric flag for the UI
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint users_avatar_key_owner
    check (avatar_key is null or avatar_key like 'avatars/' || id::text || '/%')
);

-- Biometric enrollment: one reference descriptor per user ---------------------
create table public.user_face_embeddings (
  user_id      uuid primary key references public.users(id) on delete cascade,
  embedding    extensions.vector(128) not null,
  model        text not null default 'face-api/faceRecognitionNet',
  sample_count int  not null default 1 check (sample_count > 0),
  updated_at   timestamptz not null default now()
);

-- Groups / events -------------------------------------------------------------
create table public.groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  description  text check (description is null or char_length(description) <= 2000),
  kind         text not null default 'event' check (kind in ('event', 'group')),
  event_date   date,
  location     text check (location is null or char_length(location) <= 200),
  invite_token text not null unique
               default encode(extensions.gen_random_bytes(16), 'hex'),
  created_by   uuid default auth.uid() references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.group_members (
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references public.users(id)  on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- Photos ----------------------------------------------------------------------
create table public.photos (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  uploaded_by  uuid default auth.uid() references public.users(id) on delete set null,
  storage_key  text not null unique,
  mime_type    text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes   bigint not null check (size_bytes > 0),
  width        int check (width  is null or width  > 0),
  height       int check (height is null or height > 0),
  taken_at     timestamptz,
  face_status  text not null default 'pending'
               check (face_status in ('pending', 'done', 'failed')),
  face_count   int not null default 0 check (face_count >= 0),
  has_faces    boolean generated always as (face_count > 0) stored,
  processed_at timestamptz,
  created_at   timestamptz not null default now(),
  -- The key is generated server-side by r2-presign; this blocks pointing a
  -- photo row at another group's object.
  constraint photos_storage_key_group
    check (storage_key like 'groups/' || group_id::text || '/%')
);

-- Unidentified people in an event (face clusters without an account) ---------
create table public.event_guests (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  guest_number int  not null,
  display_name text check (display_name is null or char_length(display_name) <= 100),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (group_id, guest_number)
);

-- One row per detected face in a photo ----------------------------------------
create table public.tags (
  id             uuid primary key default gen_random_uuid(),
  photo_id       uuid not null references public.photos(id) on delete cascade,
  group_id       uuid not null references public.groups(id) on delete cascade,
  user_id        uuid references public.users(id)        on delete set null,
  guest_id       uuid references public.event_guests(id) on delete set null,
  box            jsonb not null,      -- {x,y,w,h} normalised to 0..1
  det_score      real,
  match_distance real,
  source         text not null default 'auto' check (source in ('auto', 'manual')),
  assigned_by    uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint tags_single_identity check (not (user_id is not null and guest_id is not null))
);

-- Face descriptors per tag. No RLS policies => unreachable from the client.
create table public.tag_embeddings (
  tag_id    uuid primary key references public.tags(id) on delete cascade,
  group_id  uuid not null references public.groups(id) on delete cascade,
  embedding extensions.vector(128) not null
);

-- =============================================================================
-- Indexes
-- =============================================================================
create index group_members_user_idx   on public.group_members (user_id);
create index photos_group_created_idx on public.photos (group_id, created_at desc);
create index photos_uploaded_by_idx   on public.photos (uploaded_by);
create index photos_pending_idx       on public.photos (group_id) where face_status <> 'done';
create index event_guests_group_idx   on public.event_guests (group_id);
create index tags_photo_idx           on public.tags (photo_id);
create index tags_group_idx           on public.tags (group_id);
create index tags_user_idx            on public.tags (user_id)  where user_id  is not null;
create index tags_guest_idx           on public.tags (guest_id) where guest_id is not null;
create index tag_embeddings_group_idx on public.tag_embeddings (group_id);

-- Vector similarity (L2) — HNSW works well without training data.
create index tag_embeddings_hnsw_idx
  on public.tag_embeddings using hnsw (embedding extensions.vector_l2_ops);
create index user_face_embeddings_hnsw_idx
  on public.user_face_embeddings using hnsw (embedding extensions.vector_l2_ops);

-- =============================================================================
-- Triggers
-- =============================================================================
create trigger users_updated_at        before update on public.users        for each row execute function public.set_updated_at();
create trigger groups_updated_at       before update on public.groups       for each row execute function public.set_updated_at();
create trigger event_guests_updated_at before update on public.event_guests for each row execute function public.set_updated_at();
create trigger tags_updated_at         before update on public.tags         for each row execute function public.set_updated_at();
create trigger user_face_embeddings_updated_at
  before update on public.user_face_embeddings for each row execute function public.set_updated_at();

-- auth.users -> public.users
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, full_name, phone)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
                  split_part(new.email, '@', 1), ''), 100),
    nullif(left(btrim(new.raw_user_meta_data ->> 'phone'), 32), '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Creator of a group becomes its owner
create or replace function public.handle_new_group()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.group_members (group_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict do nothing;
  return new;
end $$;

create trigger on_group_created
  after insert on public.groups
  for each row execute function public.handle_new_group();

-- Keep users.face_enrolled_at in sync with the biometric table
create or replace function public.sync_face_enrolled()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    update public.users set face_enrolled_at = null where id = old.user_id;
    return old;
  end if;
  update public.users set face_enrolled_at = now() where id = new.user_id;
  return new;
end $$;

create trigger user_face_embeddings_sync
  after insert or update or delete on public.user_face_embeddings
  for each row execute function public.sync_face_enrolled();

-- A group must always keep at least one owner (unless the group is being deleted)
create or replace function public.protect_last_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and exists (select 1 from public.groups g where g.id = old.group_id)
     and not exists (
       select 1 from public.group_members m
       where m.group_id = old.group_id and m.role = 'owner' and m.user_id <> old.user_id)
  then
    raise exception 'A group must keep at least one owner' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

create trigger group_members_protect_last_owner
  before update or delete on public.group_members
  for each row execute function public.protect_last_owner();

-- A member who leaves (or is removed) is un-tagged from that group's photos
create or replace function public.handle_member_removed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.groups g where g.id = old.group_id) then
    update public.tags
       set user_id = null, match_distance = null
     where group_id = old.group_id and user_id = old.user_id;
  end if;
  return old;
end $$;

create trigger group_members_removed
  after delete on public.group_members
  for each row execute function public.handle_member_removed();

-- =============================================================================
-- RLS helper functions (SECURITY DEFINER avoids policy recursion)
-- =============================================================================
create or replace function public.is_group_member(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members
                 where group_id = p_group_id and user_id = auth.uid());
$$;

create or replace function public.is_group_admin(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members
                 where group_id = p_group_id and user_id = auth.uid()
                   and role in ('owner', 'admin'));
$$;

create or replace function public.is_group_owner(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members
                 where group_id = p_group_id and user_id = auth.uid() and role = 'owner');
$$;

create or replace function public.shares_group_with(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.group_members a
    join public.group_members b on b.group_id = a.group_id
    where a.user_id = auth.uid() and b.user_id = p_user_id);
$$;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.users                enable row level security;
alter table public.user_face_embeddings enable row level security;
alter table public.groups               enable row level security;
alter table public.group_members        enable row level security;
alter table public.photos               enable row level security;
alter table public.event_guests         enable row level security;
alter table public.tags                 enable row level security;
alter table public.tag_embeddings       enable row level security;

-- users
create policy users_select on public.users for select to authenticated
  using (id = auth.uid() or public.shares_group_with(id));
create policy users_update on public.users for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- user_face_embeddings: owner only
create policy ufe_select on public.user_face_embeddings for select to authenticated using (user_id = auth.uid());
create policy ufe_insert on public.user_face_embeddings for insert to authenticated with check (user_id = auth.uid());
create policy ufe_update on public.user_face_embeddings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ufe_delete on public.user_face_embeddings for delete to authenticated using (user_id = auth.uid());

-- groups
create policy groups_select on public.groups for select to authenticated
  using (public.is_group_member(id));
create policy groups_update on public.groups for update to authenticated
  using (public.is_group_admin(id)) with check (public.is_group_admin(id));
create policy groups_delete on public.groups for delete to authenticated
  using (public.is_group_owner(id));

-- group_members (inserts happen via trigger / join_group_by_token only)
create policy gm_select on public.group_members for select to authenticated
  using (public.is_group_member(group_id));
create policy gm_delete on public.group_members for delete to authenticated
  using (user_id = auth.uid() or public.is_group_admin(group_id));
create policy gm_update on public.group_members for update to authenticated
  using (public.is_group_owner(group_id))
  with check (public.is_group_owner(group_id));

-- photos
create policy photos_select on public.photos for select to authenticated
  using (public.is_group_member(group_id));
create policy photos_insert on public.photos for insert to authenticated
  with check (uploaded_by = auth.uid() and public.is_group_member(group_id)
              and face_status = 'pending' and face_count = 0);
create policy photos_update on public.photos for update to authenticated
  using (uploaded_by = auth.uid() or public.is_group_admin(group_id))
  with check (uploaded_by = auth.uid() or public.is_group_admin(group_id));
create policy photos_delete on public.photos for delete to authenticated
  using (uploaded_by = auth.uid() or public.is_group_admin(group_id));

-- event_guests
create policy eg_select on public.event_guests for select to authenticated
  using (public.is_group_member(group_id));
create policy eg_update on public.event_guests for update to authenticated
  using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));
create policy eg_delete on public.event_guests for delete to authenticated
  using (public.is_group_admin(group_id));

-- tags: read-only for members; every mutation goes through validated RPCs
create policy tags_select on public.tags for select to authenticated
  using (public.is_group_member(group_id));

-- tag_embeddings: RLS enabled with NO policies => no direct access.

-- Column-level privileges: restrict which columns clients may write ---------
revoke all on public.tag_embeddings from anon, authenticated;
revoke all on public.user_face_embeddings from anon;

revoke update on public.users from authenticated;
grant  update (full_name, phone, avatar_key) on public.users to authenticated;

revoke insert, update on public.groups from authenticated;   -- create via create_group()
grant  update (name, description, kind, event_date, location) on public.groups to authenticated;

revoke insert, update on public.group_members from authenticated;
grant  update (role) on public.group_members to authenticated;

revoke update on public.photos from authenticated;
grant  update (taken_at) on public.photos to authenticated;

revoke insert, update on public.event_guests from authenticated;
grant  update (display_name) on public.event_guests to authenticated;

revoke insert, update, delete on public.tags from authenticated;

-- anon has no business with any app table
revoke all on public.users, public.groups, public.group_members, public.photos,
              public.event_guests, public.tags from anon;

-- =============================================================================
-- RPC: groups & invites
-- =============================================================================

-- Create a group/event; the caller becomes its owner (atomic, RLS-safe).
create or replace function public.create_group(
  p_name text, p_description text default null, p_kind text default 'event',
  p_event_date date default null, p_location text default null)
returns public.groups language plpgsql security definer set search_path = public as $$
declare v_row public.groups;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  insert into public.groups (name, description, kind, event_date, location, created_by)
  values (btrim(p_name), nullif(btrim(p_description), ''), coalesce(p_kind, 'event'),
          p_event_date, nullif(btrim(p_location), ''), auth.uid())
  returning * into v_row;
  return v_row;   -- owner membership row is added by the on_group_created trigger
end $$;

-- Preview shown on the /join/:token page (token itself is the secret)
create or replace function public.get_invite_preview(p_token text)
returns table (group_id uuid, name text, kind text, event_date date, member_count bigint, is_member boolean)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.kind, g.event_date,
         (select count(*) from public.group_members m where m.group_id = g.id),
         exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = auth.uid())
  from public.groups g
  where g.invite_token = p_token;
$$;

create or replace function public.regenerate_invite_token(p_group_id uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_token text;
begin
  if not public.is_group_admin(p_group_id) then
    raise exception 'Only group admins can reset the invite link' using errcode = '42501';
  end if;
  v_token := encode(gen_random_bytes(16), 'hex');
  update public.groups set invite_token = v_token where id = p_group_id;
  return v_token;
end $$;

-- =============================================================================
-- RPC: face recognition
-- =============================================================================

-- Re-attribute guest faces in the caller's groups that match the caller's
-- enrolled face. Called after enrollment and after joining a group.
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

create or replace function public.join_group_by_token(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_group_id uuid;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;

  select id into v_group_id from public.groups where invite_token = p_token;
  if v_group_id is null then
    raise exception 'Invite link is invalid or has been reset' using errcode = 'P0002';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, v_uid, 'member')
  on conflict do nothing;

  perform public.resolve_my_guest_tags(v_group_id);
  return v_group_id;
end $$;

-- Store the faces the browser detected in a photo and match each one to a
-- group member, an existing guest, or a new guest.
--
-- p_faces: [{ "box": {"x":..,"y":..,"w":..,"h":..}, "score": 0.98,
--             "embedding": [128 floats] }, ...]
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
    select ufe.user_id, (ufe.embedding <-> v_emb)::real
      into v_match_user, v_dist
      from public.user_face_embeddings ufe
      join public.group_members gm on gm.user_id = ufe.user_id and gm.group_id = v_group_id
     where not (ufe.user_id = any (v_used_users))
     order by ufe.embedding <-> v_emb
     limit 1;

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
     set face_status = 'done', face_count = v_count, processed_at = now()
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

create or replace function public.mark_photo_face_failed(p_photo_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_group_id uuid;
begin
  select group_id into v_group_id from public.photos where id = p_photo_id;
  if v_group_id is null or not public.is_group_member(v_group_id) then
    raise exception 'Photo not found' using errcode = 'P0002';
  end if;
  update public.photos set face_status = 'failed', processed_at = now()
   where id = p_photo_id and face_status <> 'done';
end $$;

-- =============================================================================
-- RPC: tag management
-- =============================================================================

-- Assign a face to a member (p_user_id) or a guest (p_guest_id), or clear both.
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

-- Create a new guest for a single face ("this is someone else")
create or replace function public.split_tag_to_new_guest(p_tag_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tag public.tags%rowtype; v_guest uuid;
begin
  select * into v_tag from public.tags where id = p_tag_id;
  if v_tag.id is null or not public.is_group_member(v_tag.group_id) then
    raise exception 'Tag not found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tag.group_id::text, 0));

  insert into public.event_guests (group_id, guest_number)
  values (v_tag.group_id,
          coalesce((select max(guest_number) from public.event_guests where group_id = v_tag.group_id), 0) + 1)
  returning id into v_guest;

  perform public.assign_tag(p_tag_id, null, v_guest);
  return v_guest;
end $$;

-- Move every face of a guest to a member or to another guest, then drop it.
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
       and exists (select 1 from public.tags x where x.photo_id = t.photo_id and x.user_id = p_user_id);
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

-- Remove a face tag: the tagged person, the uploader, or a group admin.
create or replace function public.delete_tag(p_tag_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_tag public.tags%rowtype; v_uploader uuid;
begin
  select * into v_tag from public.tags where id = p_tag_id;
  if v_tag.id is null or not public.is_group_member(v_tag.group_id) then
    raise exception 'Tag not found' using errcode = 'P0002';
  end if;
  select uploaded_by into v_uploader from public.photos where id = v_tag.photo_id;

  if not (v_tag.user_id = auth.uid() or v_uploader = auth.uid() or public.is_group_admin(v_tag.group_id)) then
    raise exception 'Not allowed to remove this tag' using errcode = '42501';
  end if;

  delete from public.tags where id = p_tag_id;
  update public.photos
     set face_count = (select count(*) from public.tags where photo_id = v_tag.photo_id)
   where id = v_tag.photo_id;
  delete from public.event_guests eg
   where eg.id = v_tag.guest_id and not exists (select 1 from public.tags t where t.guest_id = eg.id);
end $$;

-- =============================================================================
-- RPC: read models (SECURITY INVOKER => RLS applies)
-- =============================================================================

-- People folders for a group: members + guests, with photo counts and a
-- sample face for the thumbnail.
create or replace function public.get_group_people(p_group_id uuid)
returns table (
  kind text, user_id uuid, guest_id uuid, name text, avatar_key text,
  photo_count bigint, sample_storage_key text, sample_box jsonb
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
         u.avatar_key, a.photo_count, p.storage_key, a.sample_box
  from agg a
  left join public.users u         on u.id  = a.user_id
  left join public.event_guests eg on eg.id = a.guest_id
  left join public.photos p        on p.id  = a.sample_photo
  order by (a.kind = 'member') desc, a.photo_count desc;
$$;

-- =============================================================================
-- Function privileges
-- =============================================================================
revoke execute on all functions in schema public from public, anon;

grant execute on function public.face_match_threshold()                      to authenticated;
grant execute on function public.is_group_member(uuid)                       to authenticated;
grant execute on function public.is_group_admin(uuid)                        to authenticated;
grant execute on function public.is_group_owner(uuid)                        to authenticated;
grant execute on function public.shares_group_with(uuid)                     to authenticated;
grant execute on function public.create_group(text, text, text, date, text)  to authenticated;
grant execute on function public.get_invite_preview(text)                    to authenticated;
grant execute on function public.regenerate_invite_token(uuid)               to authenticated;
grant execute on function public.resolve_my_guest_tags(uuid)                 to authenticated;
grant execute on function public.join_group_by_token(text)                   to authenticated;
grant execute on function public.ingest_photo_faces(uuid, jsonb)             to authenticated;
grant execute on function public.mark_photo_face_failed(uuid)                to authenticated;
grant execute on function public.assign_tag(uuid, uuid, uuid)                to authenticated;
grant execute on function public.split_tag_to_new_guest(uuid)                to authenticated;
grant execute on function public.merge_guest(uuid, uuid, uuid)               to authenticated;
grant execute on function public.delete_tag(uuid)                            to authenticated;
grant execute on function public.get_group_people(uuid)                      to authenticated;
